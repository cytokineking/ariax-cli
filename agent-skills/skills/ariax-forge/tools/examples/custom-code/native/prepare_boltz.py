"""Clone the compatible source in base and save its visible local edit."""

import ast
import json
from pathlib import Path
import shutil
import subprocess
import sys

SOURCE = Path("/scratch/boltz-source")
COMMIT = "cb04aeccdd480fd4db707f0bbafde538397fa2ac"
SOURCE.mkdir(exist_ok=False)
for args in [
    ["init", "--quiet"],
    ["remote", "add", "origin", "https://github.com/jwohlwend/boltz.git"],
    ["fetch", "--depth=1", "--no-tags", "origin", COMMIT],
    ["checkout", "--quiet", "--detach", "FETCH_HEAD"],
]:
    subprocess.run(["git", "-C", str(SOURCE), *args], check=True)
main = SOURCE / "src/boltz/main.py"
text = main.read_text()
node = next(
    n
    for n in ast.walk(ast.parse(text))
    if isinstance(n, ast.FunctionDef) and n.name == "predict"
)
first = node.body[0]
line = (
    first.end_lineno + 1
    if isinstance(first, ast.Expr)
    and isinstance(first.value, ast.Constant)
    and isinstance(first.value.value, str)
    else first.lineno
)
lines = text.splitlines(keepends=True)
lines.insert(
    line - 1, '    click.echo("B25 project-local predict loaded: " + __file__)\n'
)
main.write_text("".join(lines))
(SOURCE / "src/boltz/b25_main.py").symlink_to("main.py")
(SOURCE / "b25-local-edit.txt").write_text(
    "Predict prints the executing project-local source path. Scientific arguments and calculation stay at v2.2.1.\n"
)
saved = Path("/workspace/custom/boltz")
saved.mkdir(parents=True)
subprocess.run(
    [
        sys.executable,
        "/inputs/custom-code/source_bundle.py",
        "save",
        str(SOURCE),
        str(saved / "source.tar"),
        "--tool",
        "boltz2",
        "--asset",
        "boltz2",
    ],
    check=True,
)
shutil.copyfile("/inputs/custom-code/native/bootstrap_boltz.py", saved / "bootstrap.py")
(saved / "requirements.txt").write_text(
    "# Reuse the accepted image dependencies. Local editable Boltz 2.2.1 only.\n"
)
(saved / "choice.json").write_text(
    json.dumps(
        {
            "repository": "https://github.com/jwohlwend/boltz",
            "commit": COMMIT,
            "tool": "boltz2",
            "asset": "boltz2",
            "model": "boltz2",
            "checkpoint": "/models/boltz2/boltz2_conf.ckpt",
            "local_edit": "predict prints source __file__",
            "link": "src/boltz/b25_main.py -> main.py",
        },
        indent=2,
    )
    + "\n"
)
print(subprocess.check_output(["git", "--version"], text=True).strip())
print(sys.version)

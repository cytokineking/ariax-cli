"""Exercise the patched native trajectory budget inside the FreeBindCraft image."""
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, "/opt/freebindcraft")
from functions.generic_utils import check_n_trajectories, generate_directories


def main() -> None:
    for rejection in ("LowConfidence", "Clashing"):
        with TemporaryDirectory(dir="/scratch") as directory:
            paths = generate_directories(directory)
            assert not check_n_trajectories(paths, {"max_trajectories": 1})
            (Path(paths[f"Trajectory/{rejection}"]) / "rejected.pdb").touch()
            assert check_n_trajectories(paths, {"max_trajectories": 1}), rejection
    with TemporaryDirectory(dir="/scratch") as directory:
        paths = generate_directories(directory)
        for folder in ("Trajectory", "Trajectory/Relaxed"):
            (Path(paths[folder]) / "completed.pdb").touch()
        assert not check_n_trajectories(paths, {"max_trajectories": 2}), "One trajectory was counted twice"
        (Path(paths["Trajectory/Clashing"]) / "rejected.pdb").touch()
        assert check_n_trajectories(paths, {"max_trajectories": 2})
    print("Native trajectory limits passed for rejected attempts and deduplicated completed attempts")


if __name__ == "__main__":
    main()

"""Stage the installed bounded molecular inputs in the remote workspace."""
import argparse
from pathlib import Path
import shutil
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('inputs',type=Path)
p.add_argument('--out',type=Path,required=True)
a=p.parse_args()
assert a.out.resolve().is_relative_to(Path('/workspace')),'Output must be under /workspace'
destination=a.out/'inputs';destination.mkdir(parents=True,exist_ok=True)
count=0
for source in sorted(a.inputs.iterdir()):
 if not source.is_file() or source.is_symlink() or source.suffix not in ('.json','.yaml'):raise ValueError('Expected regular molecular JSON/YAML inputs')
 target=destination/source.name
 if target.exists():
  if target.is_symlink() or target.read_bytes()!=source.read_bytes():raise ValueError('Existing molecular input differs: '+source.name)
 else:shutil.copyfile(source,target)
 count+=1
print(str(count)+' installed molecular inputs staged or matched byte for byte')

"""Build a complete offline installer from the verified official runtime ZIP.

No network requests are made by this builder or by the resulting installer.
The runtime SHA-256 is pinned to the verified official tagged build artifact.
"""
from pathlib import Path
import argparse, importlib.util, json

ROOT=Path(__file__).resolve().parents[1]

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime',type=Path,required=True)
    parser.add_argument('--output',type=Path)
    args=parser.parse_args()
    spec=importlib.util.spec_from_file_location('installer_builder',ROOT/'installer/build-online-exe.py')
    builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
    version=json.loads((ROOT/'package.json').read_text())['version']
    output=args.output.resolve() if args.output else ROOT.parent/('InkNote-Setup-'+version+'-offline.exe')
    print(json.dumps(builder.build(output,args.runtime)))

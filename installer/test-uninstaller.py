from pathlib import Path
import os, subprocess, tempfile
root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='inknote-uninstall-test-') as directory:
    output=Path(directory)/'uninstall-test'
    for mode in [[],['-DINKNOTE_CURRENT=1']]:
        subprocess.run(['gcc','-std=c11','-O1','-Wall','-Wextra','-Wno-unused-function','-Wno-misleading-indentation','-fshort-wchar','-fsanitize=address,undefined',*mode,str(root/'tests/uninstall_native_test.c'),'-o',str(output)],check=True)
        # No heap is allocated; retain ASan/UBSan without /proc-dependent LSan.
        subprocess.run([str(output)],check=True,env={**os.environ,'ASAN_OPTIONS':'detect_leaks=0'})

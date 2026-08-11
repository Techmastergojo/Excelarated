"""
Build script: produces Excelarated.exe
Run from the project root:  python build_exe.py
"""
import os
import shutil
import subprocess
import sys

PROJECT_ROOT  = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR   = os.path.join(PROJECT_ROOT, "backend")
FRONTEND_DIR  = os.path.join(PROJECT_ROOT, "frontend")
DIST_DIR      = os.path.join(PROJECT_ROOT, "dist_exe")

def step(msg):
    print(f"\n{'='*55}")
    print(f"  {msg}")
    print(f"{'='*55}")

# 1. Build React frontend
step("Step 1/3 - Building React frontend...")
subprocess.run(["npm", "run", "build"], cwd=FRONTEND_DIR, check=True, shell=True)

# 2. Copy frontend dist into backend folder so PyInstaller bundles it
frontend_dist_src  = os.path.join(FRONTEND_DIR, "dist")
frontend_dist_dest = os.path.join(BACKEND_DIR, "frontend_dist")
if os.path.exists(frontend_dist_dest):
    shutil.rmtree(frontend_dist_dest)
shutil.copytree(frontend_dist_src, frontend_dist_dest)
print("  Copied frontend dist -> backend/frontend_dist")

# 3. Run PyInstaller
step("Step 2/3 - Packaging with PyInstaller...")
pyinstaller_cmd = [
    sys.executable, "-m", "PyInstaller",
    "--onefile",
    "--windowed",          # No console window (silent background server)
    "--name", "Excelarated",
    "--distpath", DIST_DIR,
    "--workpath", os.path.join(PROJECT_ROOT, "build_tmp"),
    "--specpath", PROJECT_ROOT,
    # Bundle the frontend_dist folder
    "--add-data", f"{frontend_dist_dest}{os.pathsep}frontend_dist",
    # Entry point
    os.path.join(BACKEND_DIR, "main.py"),
]
subprocess.run(pyinstaller_cmd, cwd=BACKEND_DIR, check=True)

step("Step 3/3 - Done!")
exe_path = os.path.join(DIST_DIR, "Excelarated.exe")
if os.path.exists(exe_path):
    print(f"  OK! Executable ready: {exe_path}")
    print("  Double-click Excelarated.exe to launch the app!")
else:
    print("  WARNING: exe not found - check PyInstaller output above.")

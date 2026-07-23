"""Processo pai de teste: spawna um filho (sleepy_child.py) e grava o PID
do filho, de forma determinística, no arquivo passado em argv[1] (o teste
lê esse arquivo para obter o PID do filho — nunca assume ausência de PID
como sucesso), depois dorme para permanecer vivo até ser terminado pelo
teste (via JobRegistry.cancel, que deve matar pai + filho)."""
import os
import subprocess
import sys
import time

if __name__ == '__main__':
    pid_file = sys.argv[1]
    here = os.path.dirname(os.path.abspath(__file__))
    child_script = os.path.join(here, 'sleepy_child.py')
    proc = subprocess.Popen([sys.executable, child_script])
    with open(pid_file, 'w', encoding='utf-8') as f:
        f.write(str(proc.pid))
        f.flush()
        os.fsync(f.fileno())
    time.sleep(120)

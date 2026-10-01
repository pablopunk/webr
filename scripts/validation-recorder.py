import base64
import fcntl
import json
import os
import select
import signal
import struct
import sys
import termios
import tty

root, nonce = os.path.dirname(os.path.realpath(__file__)), sys.argv[1]
state = {"nonce": nonce, "pid": os.getpid(), "bytes": "", "cols": 0, "rows": 0, "commands": []}
captured = bytearray()
original = termios.tcgetattr(0)
resized = False

def save():
    rows, cols, _, _ = struct.unpack("HHHH", fcntl.ioctl(0, termios.TIOCGWINSZ, b"\0" * 8))
    state.update({"cols": cols, "rows": rows, "bytes": base64.b64encode(captured).decode()})
    path = os.path.join(root, "state.tmp")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(state, stream)
    os.replace(path, os.path.join(root, "state.json"))

def emit(text):
    os.write(1, ("\r\n" + text + "\r\n").encode())

def mark_resize(*_):
    global resized
    resized = True

signal.signal(signal.SIGWINCH, mark_resize)
try:
    tty.setraw(0)
    os.write(1, b"\x1b[?2004h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h")
    save()
    emit("READY-" + nonce)
    while True:
        if resized:
            resized = False
            save()
        command_path = os.path.join(root, "command.json")
        if os.path.exists(command_path):
            with open(command_path) as stream:
                command = json.load(stream)
            if command["id"] not in state["commands"]:
                if command["op"] == "query":
                    os.write(1, b"\x1b[6n")
                emit(command.get("text", command["id"]))
                state["commands"] = (state["commands"] + [command["id"]])[-128:]
                save()
        if select.select([0], [], [], 0.02)[0]:
            data = os.read(0, 4096)
            if not data:
                break
            captured.extend(data)
            if len(captured) > 65536:
                raise RuntimeError("recorder byte limit")
            save()
            emit("BYTES-" + str(len(captured)))
finally:
    termios.tcsetattr(0, termios.TCSANOW, original)

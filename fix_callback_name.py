with open("firmware/physiopulse_firmware/physiopulse_firmware.ino", "r") as f:
    content = f.read()

content = content.replace("class BLEServerCallbacks : public BLEServerCallbacks {", "class MyBLEServerCallbacks : public BLEServerCallbacks {")
content = content.replace("pBLEServer->setCallbacks(new BLEServerCallbacks());", "pBLEServer->setCallbacks(new MyBLEServerCallbacks());")

with open("firmware/physiopulse_firmware/physiopulse_firmware.ino", "w") as f:
    f.write(content)

print("Fixed class redefinition error successfully!")

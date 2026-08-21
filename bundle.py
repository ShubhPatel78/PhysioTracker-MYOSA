import os, base64

webapp_dir = r"c:\Users\DHRUVAM\OneDrive\Desktop\MYOSA 6.0 PhysioPulse\webapp"
out_file = r"c:\Users\DHRUVAM\OneDrive\Desktop\MYOSA 6.0 PhysioPulse\firmware\physiopulse_firmware\webapp_data.h"

with open(os.path.join(webapp_dir, "index.html"), "r", encoding="utf-8") as f:
    html = f.read()

# Inline CSS
with open(os.path.join(webapp_dir, "css", "style.css"), "r", encoding="utf-8") as f:
    css = f.read()
html = html.replace('<link rel="stylesheet" href="css/style.css" />', f"<style>{css}</style>")

# Inline JS
js_files = ["connection.js", "charts.js", "session.js", "auth.js", "doctor-portal.js", "patient-portal.js", "app.js"]
for js_file in js_files:
    with open(os.path.join(webapp_dir, "js", js_file), "r", encoding="utf-8") as f:
        js = f.read()
    html = html.replace(f'<script src="js/{js_file}"></script>', f"<script>{js}</script>")

# Remove manifest and sw links since we aren't serving them as separate files anymore to keep it simple
html = html.replace('<link rel="manifest" href="manifest.json" />', "")
html = html.replace("navigator.serviceWorker.register('/sw.js')", "// SW removed for single-file version")

# Write to header
with open(out_file, "w", encoding="utf-8") as f:
    f.write("#pragma once\n\n")
    f.write(f"const char webapp_html[] PROGMEM = R\"rawliteral({html})rawliteral\";\n")
    
print("Successfully generated webapp_data.h")

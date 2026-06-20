import sys

# Reconfigure stdout to use utf-8 on Windows
sys.stdout.reconfigure(encoding='utf-8')

with open("reference.md", "r", encoding="utf-8") as f:
    lines = f.readlines()

print("--- OPENAI_API_KEY SECTIONS ---")
for idx, line in enumerate(lines):
    if "OPENAI_API_KEY" in line or "BYO" in line or "sampling" in line.lower():
        start = max(0, idx - 5)
        end = min(len(lines), idx + 8)
        print(f"\n[Lines {start} to {end}]:")
        print("".join(lines[start:end]))

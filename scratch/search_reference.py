import sys
sys.stdout.reconfigure(encoding='utf-8')

with open("reference.md", "r", encoding="utf-8") as f:
    content = f.read()

# Let's search for CLI usage or environment variables that configures local OpenAI keys
import re
pattern = re.compile(r"(?:OPENAI_API_KEY|sk-proj|--llm|--openai|openai)", re.IGNORECASE)

matches = []
for m in pattern.finditer(content):
    pos = m.start()
    start = max(0, pos - 200)
    end = min(len(content), pos + 250)
    snippet = content[start:end].replace('\n', ' ')
    matches.append(snippet)

print(f"Found {len(matches)} matches. Printing unique or notable ones:")
seen = set()
for m in matches:
    clean = m.strip()[:100]
    if clean not in seen:
        seen.add(clean)
        print("-", clean, "...")
        print("  Snippet:", m)
        print()

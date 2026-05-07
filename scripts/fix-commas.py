"""
Add missing trailing commas after _en field values that are missing one.
"""
import re
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('courses.js', encoding='utf-8') as f:
    text = f.read()

# Find lines where a key:value is NOT followed by comma but next line is another key
# pattern: end-of-line-without-comma (string ends with quote and newline) + next line has key:
# Generic: any line that ends with ' or " (no comma) followed by newline then whitespace + identifier:
pattern = re.compile(
    r"(\n\s*\w+:\s*(['\"])[^'\"]*?\2)(\s*\n\s*\w+:)",
    re.DOTALL
)

count = 0
while True:
    new_text, n = pattern.subn(r"\1,\3", text)
    if n == 0:
        break
    count += n
    text = new_text

with open('courses.js', 'w', encoding='utf-8') as f:
    f.write(text)

print(f"Added {count} missing commas")

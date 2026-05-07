"""
courses.js の重複した name_en, description_en, areaName_en を除去
"""
import re
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('courses.js', encoding='utf-8') as f:
    text = f.read()

# Remove duplicate name_en lines: when two consecutive lines start with `name_en:`
# Keep only the second one (the one with the comma)
def dedup_consecutive(text, key):
    pattern = re.compile(
        r"(\n\s*" + key + r":\s*'[^']+'\s*\n)(\s*" + key + r":\s*'[^']+',?\s*\n)",
        re.DOTALL
    )
    while True:
        new_text, n = pattern.subn(r"\2", text)
        if n == 0:
            break
        text = new_text
    # Also handle double-quoted version
    pattern2 = re.compile(
        r"(\n\s*" + key + r":\s*\"[^\"]+\"\s*\n)(\s*" + key + r":\s*\"[^\"]+\",?\s*\n)",
        re.DOTALL
    )
    while True:
        new_text, n = pattern2.subn(r"\2", text)
        if n == 0:
            break
        text = new_text
    # Mixed quotes
    pattern3 = re.compile(
        r"(\n\s*" + key + r":\s*\"[^\"]+\"\s*\n)(\s*" + key + r":\s*'[^']+',?\s*\n)",
        re.DOTALL
    )
    while True:
        new_text, n = pattern3.subn(r"\2", text)
        if n == 0:
            break
        text = new_text
    pattern4 = re.compile(
        r"(\n\s*" + key + r":\s*'[^']+'\s*\n)(\s*" + key + r":\s*\"[^\"]+\",?\s*\n)",
        re.DOTALL
    )
    while True:
        new_text, n = pattern4.subn(r"\2", text)
        if n == 0:
            break
        text = new_text
    return text


for key in ['name_en', 'description_en', 'areaName_en']:
    text = dedup_consecutive(text, key)

with open('courses.js', 'w', encoding='utf-8') as f:
    f.write(text)

print('Duplicates removed.')

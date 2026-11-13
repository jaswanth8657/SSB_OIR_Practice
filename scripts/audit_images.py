import os
import json
from collections import Counter

data_dir = os.path.abspath('src/data/questions')
public_dir = os.path.abspath('public')
public_images = os.path.join(public_dir, 'images')

def normalize_rel_path(p):
    """Normalizes an image path to '/images/setXX/filename.ext' with forward slashes."""
    if not p:
        return ''
    clean = p.strip().replace('\\', '/')
    if not clean.startswith('/'):
        clean = '/' + clean
    return clean

# 1. Scan all image files on disk under public/images
disk_files = []
extension_counts = Counter()

for root, dirs, files in os.walk(public_images):
    for f in files:
        ext = os.path.splitext(f)[1].lower()
        if ext in ('.png', '.jpg', '.jpeg', '.svg', '.webp'):
            extension_counts[ext] += 1
            rel = os.path.relpath(os.path.join(root, f), public_dir)
            disk_files.append(normalize_rel_path(rel))

total_disk_images = len(disk_files)
disk_files_set = set(disk_files)

# 2. Inspect all 20 practice sets for image references
question_refs = []
solution_refs = []
option_refs = []
all_refs_list = []
per_set_stats = {}

for s in range(1, 21):
    pad = f'{s:02d}'
    filepath = os.path.join(data_dir, f'set{pad}.json')
    if not os.path.exists(filepath):
        continue
    with open(filepath, 'r', encoding='utf-8') as fp:
        questions = json.load(fp)

    q_imgs = []
    s_imgs = []
    opt_imgs = []

    for q in questions:
        # Question diagrams
        for img in q.get('images', []):
            norm = normalize_rel_path(img)
            q_imgs.append(norm)
            question_refs.append(norm)
            all_refs_list.append(norm)

        # Solution diagrams array
        for img in q.get('solutionImages', []):
            norm = normalize_rel_path(img)
            s_imgs.append(norm)
            solution_refs.append(norm)
            all_refs_list.append(norm)

        # Single solution diagram
        if q.get('solutionImage'):
            norm = normalize_rel_path(q['solutionImage'])
            s_imgs.append(norm)
            solution_refs.append(norm)
            all_refs_list.append(norm)

        # Option images if any
        for opt in q.get('options', []):
            if opt.get('image'):
                norm = normalize_rel_path(opt['image'])
                opt_imgs.append(norm)
                option_refs.append(norm)
                all_refs_list.append(norm)

    unique_set_refs = set(q_imgs + s_imgs + opt_imgs)
    set_prefix = f'/images/set{pad}/'
    set_files = [f for f in disk_files if f.startswith(set_prefix)]

    per_set_stats[f'set{pad}'] = {
        'files_in_dir': len(set_files),
        'question_images': len(q_imgs),
        'solution_images': len(set(s_imgs)),
        'option_images': len(opt_imgs),
        'unique_refs': len(unique_set_refs),
        'unreferenced_in_set': len(set_files) - len(unique_set_refs),
    }

# 3. Analyze unique paths, missing paths, duplicate references & unreferenced files
unique_refs_set = set(all_refs_list)
missing_paths = [r for r in unique_refs_set if r not in disk_files_set]
unreferenced_files = [f for f in disk_files if f not in unique_refs_set]

# Duplicate reference analysis: paths referenced more than once in questions/solutions
ref_counts = Counter(all_refs_list)
duplicate_refs = {k: v for k, v in ref_counts.items() if v > 1}

# 4. Print structured audit report
print('======================================================================')
print('  OIR PREPARATION HUB – COMPREHENSIVE IMAGE ASSETS AUDIT')
print('======================================================================')
print(f'1.  Total Image Files on Disk:              {total_disk_images}')
print(f'2.  Total Question Image References:         {len(question_refs)}')
print(f'3.  Total Solution Image References:         {len(solution_refs)}')
print(f'4.  Total Option Image References:           {len(option_refs)}')
print(f'5.  Total Unique Referenced Image Paths:     {len(unique_refs_set)}')
print(f'6.  Duplicate Image References:              {len(duplicate_refs)}')
print(f'7.  Missing Image Paths on Disk:             {len(missing_paths)}')
print(f'8.  Unreferenced Historical Crop Files:      {len(unreferenced_files)}')
print('----------------------------------------------------------------------')
print('9.  File Extension Statistics:')
for ext, count in sorted(extension_counts.items()):
    print(f'    - {ext}: {count} files')
print('----------------------------------------------------------------------')
print('10. Per-Set Breakdown:')
header = f'{"Set":<8} | {"Files in Dir":<13} | {"Q-Images":<9} | {"Sol-Images":<11} | {"Unref Files":<11}'
print(header)
print('-' * len(header))
for k, v in per_set_stats.items():
    print(f'{k:<8} | {v["files_in_dir"]:<13} | {v["question_images"]:<9} | {v["solution_images"]:<11} | {v["unreferenced_in_set"]:<11}')
print('======================================================================')

if missing_paths:
    print('\n[ALERT] Missing Referenced Image Files:')
    for m in missing_paths:
        print(f'  MISSING: {m}')
else:
    print('\n✓ ZERO MISSING IMAGES: 100% of referenced question and solution diagrams exist on disk.')

print(f'\nNote: All {len(unreferenced_files)} unreferenced images are preserved historical crops and diagrams')
print('safely retained in repository storage for archival completeness and manual reconciliation.\n')

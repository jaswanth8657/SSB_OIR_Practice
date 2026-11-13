import os
import json

data_dir = 'src/data/questions'
public_images = 'public/images'

all_files = []
for root, dirs, files in os.walk(public_images):
    for f in files:
        if f.lower().endswith(('.png', '.jpg', '.jpeg')):
            rel = os.path.relpath(os.path.join(root, f), 'public').replace('\\', '/')
            all_files.append('/' + rel)

total_repo_images = len(all_files)
repo_images_set = set(all_files)

question_refs = []
solution_refs = []
option_refs = []
per_set_stats = {}

for s in range(1, 21):
    pad = f'{s:02d}'
    filepath = os.path.join(data_dir, f'set{pad}.json')
    with open(filepath, 'r', encoding='utf-8') as fp:
        questions = json.load(fp)
    
    q_imgs = []
    s_imgs = []
    opt_imgs = []
    
    for q in questions:
        for img in q.get('images', []):
            q_imgs.append(img)
            question_refs.append(img)
        for img in q.get('solutionImages', []):
            s_imgs.append(img)
            solution_refs.append(img)
        if q.get('solutionImage'):
            s_imgs.append(q['solutionImage'])
            solution_refs.append(q['solutionImage'])
        for opt in q.get('options', []):
            if opt.get('image'):
                opt_imgs.append(opt['image'])
                option_refs.append(opt['image'])
                
    unique_set_refs = set(q_imgs + s_imgs + opt_imgs)
    set_files = [f for f in all_files if f.startswith(f'/images/set{pad}/')]
    
    per_set_stats[f'set{pad}'] = {
        'files_in_dir': len(set_files),
        'question_images': len(q_imgs),
        'solution_images': len(set(s_imgs)),
        'unique_refs': len(unique_set_refs),
        'unreferenced_in_set': len(set_files) - len(unique_set_refs)
    }

all_refs = set(question_refs + solution_refs + option_refs)
missing_paths = [r for r in all_refs if r not in repo_images_set]
unreferenced = [f for f in all_files if f not in all_refs]

print('======================================================')
print('  IMAGE ASSETS RECONCILIATION AUDIT REPORT')
print('======================================================')
print(f'Total repository image files: {total_repo_images}')
print(f'Total question image references: {len(question_refs)}')
print(f'Total solution image references: {len(solution_refs)}')
print(f'Total unique referenced image paths: {len(all_refs)}')
print(f'Total missing image paths: {len(missing_paths)}')
print(f'Total unreferenced image files: {len(unreferenced)}')
print('------------------------------------------------------')
print('Per-Set Breakdown:')
print(f'{"Set":<8} | {"Files in Dir":<14} | {"Q-Images":<10} | {"Sol-Images":<12} | {"Unref Files":<12}')
print('-' * 64)
for k, v in per_set_stats.items():
    print(f'{k:<8} | {v["files_in_dir"]:<14} | {v["question_images"]:<10} | {v["solution_images"]:<12} | {v["unreferenced_in_set"]:<12}')
print('======================================================')

if unreferenced:
    print(f'\nSample unreferenced files (first 10 of {len(unreferenced)}):')
    for u in unreferenced[:10]:
        print(f'  {u}')

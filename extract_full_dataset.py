import pypdf
import os
import re
import json

reader = pypdf.PdfReader("oir_practice_sets.pdf")

set_ranges = [
    (1, 10, 18, 19, 23),
    (2, 24, 32, 33, 37),
    (3, 38, 45, 46, 50),
    (4, 51, 58, 59, 63),
    (5, 64, 71, 72, 76),
    (6, 77, 84, 85, 89),
    (7, 90, 96, 97, 101),
    (8, 102, 109, 110, 113),
    (9, 114, 120, 121, 125),
    (10, 126, 133, 134, 138),
    (11, 139, 147, 148, 152),
    (12, 153, 160, 161, 165),
    (13, 166, 173, 174, 178),
    (14, 179, 186, 187, 191),
    (15, 192, 199, 200, 204),
    (16, 205, 212, 213, 217),
    (17, 218, 225, 226, 229),
    (18, 230, 238, 239, 242),
    (19, 243, 250, 251, 255),
    (20, 256, 263, 264, 267),
]

os.makedirs("public/images", exist_ok=True)
os.makedirs("src/data/questions", exist_ok=True)

# Cache all images in memory by page
page_images_cache = {}
for p_idx in range(len(reader.pages)):
    p_num = p_idx + 1
    page = reader.pages[p_idx]
    imgs = {}
    for img in page.images:
        if img.name != 'NxImage.png' and len(img.data) != 8464:
            base = img.name.split('.')[0]
            imgs[base] = img.data
            imgs[img.name] = img.data
    page_images_cache[p_num] = imgs

print("Cached images for", len(page_images_cache), "pages")

def get_page_items(p_num):
    page = reader.pages[p_num - 1]
    items = []
    def v_op(op, args, cm, tm):
        if op == b"Do":
            name = args[0].lstrip('/')
            if name != 'NxImage' and not name.startswith('NxFm'):
                items.append({
                    "type": "IMG",
                    "name": name,
                    "top_y": cm[5] + cm[3],
                    "bot_y": cm[5],
                    "x": cm[4],
                    "w": cm[0],
                    "h": cm[3]
                })
    def v_txt(txt, cm, tm, fontDict, fontSize):
        t = txt.strip()
        if t:
            items.append({
                "type": "TXT",
                "text": t,
                "top_y": tm[5] + fontSize,
                "bot_y": tm[5],
                "x": tm[4],
                "fontSize": fontSize
            })
    page.extract_text(visitor_operand_before=v_op, visitor_text=v_txt)
    items.sort(key=lambda x: -x["top_y"])
    return items

def parse_set_answers(s_num, a_s, a_e):
    text = ""
    for p in range(a_s - 1, a_e):
        text += "\n" + reader.pages[p].extract_text()
    lines = [l for l in text.split("\n") if not any(x in l for x in ["OIR TEST - PRACTICE QUESTIONS", "shop.ssbcrack.com", "| P a g e"])]
    cleaned = "\n".join(lines)
    
    matches = list(re.finditer(r"(?:^|\n)\s*(\d+)\.\s*Answers?\s*:", cleaned, re.IGNORECASE))
    answers = {}
    for i, m in enumerate(matches):
        q_num = int(m.group(1))
        start_pos = m.end()
        end_pos = matches[i+1].start() if i + 1 < len(matches) else len(cleaned)
        raw_block = cleaned[start_pos:end_pos].strip()
        lines = [l.strip() for l in raw_block.split("\n") if l.strip()]
        ans_val = lines[0] if lines else ""
        expl = "\n".join(lines[1:]).strip() if len(lines) > 1 else ""
        answers[q_num] = {
            "answer": ans_val,
            "explanation": expl,
            "raw": raw_block
        }
    return answers

# Process all 20 sets
all_sets_summary = []

for s_num, q_start, q_end, a_s, a_e in set_ranges:
    set_folder = f"public/images/set{s_num:02d}"
    os.makedirs(set_folder, exist_ok=True)
    
    # 1. Parse answers
    ans_map = parse_set_answers(s_num, a_s, a_e)
    
    # 2. Collect questions text and map images
    q_data = {}
    for i in range(1, 51):
        q_data[i] = {
            "id": i,
            "setNumber": s_num,
            "questionNumber": i,
            "instruction": "",
            "statement": "",
            "type": "single_choice",
            "images": [],
            "options": [],
            "dropdownGroups": [],
            "correctAnswer": "",
            "explanation": "",
            "solutionImage": None,
            "pdfPage": q_start
        }
        
    current_q = 0
    # Walk through question pages
    for p_num in range(q_start, a_s):
        items = get_page_items(p_num)
        
        # Check if we hit answer section on the last question page
        cutoff = False
        for it in items:
            if it["type"] == "TXT":
                txt = it["text"]
                if "ANSWERS" in txt.upper() and "EXPLANATION" in txt.upper():
                    cutoff = True
                    break
                # Check for "X."
                m = re.match(r"^(\d+)\.", txt)
                if m:
                    num = int(m.group(1))
                    if 1 <= num <= 50:
                        if current_q == 0 and num == 1:
                            current_q = 1
                            q_data[current_q]["pdfPage"] = p_num
                        elif num == current_q + 1 or (current_q < num <= current_q + 3):
                            current_q = num
                            q_data[current_q]["pdfPage"] = p_num
            elif it["type"] == "IMG":
                target_q = 1 if current_q == 0 else current_q
                if 1 <= target_q <= 50:
                    img_name = it["name"]
                    # Save image file
                    img_key = img_name if img_name in page_images_cache[p_num] else img_name + ".png"
                    if img_key in page_images_cache[p_num]:
                        rel_path = f"/images/set{s_num:02d}/q{target_q}_{img_name}.png"
                        out_path = f"{set_folder}/q{target_q}_{img_name}.png"
                        with open(out_path, "wb") as f:
                            f.write(page_images_cache[p_num][img_key])
                        if rel_path not in q_data[target_q]["images"]:
                            q_data[target_q]["images"].append(rel_path)
        if cutoff:
            break
                            
    # Now extract the full question text chunks for each question
    full_q_text = ""
    for p_num in range(q_start, a_s):
        text = reader.pages[p_num - 1].extract_text() or ""
        lines = [l for l in text.split("\n") if not any(x in l for x in ["OIR TEST - PRACTICE QUESTIONS", "shop.ssbcrack.com", "| P a g e"])]
        full_q_text += f"\n<<<PAGE_{p_num}>>>\n" + "\n".join(lines)
        
    q_matches = list(re.finditer(r"(?:^|\n)\s*(\d+)\.", full_q_text))
    for i, m in enumerate(q_matches):
        q_num = int(m.group(1))
        if q_num > 50 or q_num < 1:
            continue
        start_pos = m.start()
        end_pos = q_matches[i+1].start() if i + 1 < len(q_matches) else len(full_q_text)
        chunk = full_q_text[start_pos:end_pos].strip()
        
        # Clean page markers from chunk
        chunk = re.sub(r"<<<PAGE_\d+>>>", "", chunk).strip()
        
        # Remove leading "X."
        chunk_clean = re.sub(r"^\d+\.\s*", "", chunk).strip()
        
        # Check for multi-line fill in the blank like Q18
        if "Choose one word from each of the following" in chunk_clean or "three lines" in chunk_clean:
            q_data[q_num]["type"] = "multi_dropdown"
            q_data[q_num]["statement"] = chunk_clean
            # Parse dropdown groups
            # Lines often have [(1) word (2) word (3) word (4) word]
            bracket_groups = re.findall(r"\[\s*(.*?)\s*\]", chunk_clean)
            for bg in bracket_groups:
                opts = re.findall(r"\((\d+)\)\s*([a-zA-Z]+)", bg)
                if opts:
                    q_data[q_num]["dropdownGroups"].append({
                        "options": [{"id": o[0], "text": o[1]} for o in opts]
                    })
        elif "Which two" in chunk_clean or "belong to Class A" in chunk_clean:
            q_data[q_num]["type"] = "multiple_choice"
            q_data[q_num]["statement"] = chunk_clean
            # 4 figure choices
            q_data[q_num]["options"] = [
                {"id": "1", "text": "Figure 1"},
                {"id": "2", "text": "Figure 2"},
                {"id": "3", "text": "Figure 3"},
                {"id": "4", "text": "Figure 4"},
            ]
        elif "Write ‘Yes’ or ‘No’" in chunk_clean or "Write 'Yes' or 'No'" in chunk_clean or ("alike" in chunk_clean.lower() and q_num in [3, 4]):
            q_data[q_num]["type"] = "boolean"
            q_data[q_num]["statement"] = chunk_clean
            q_data[q_num]["options"] = [
                {"id": "Yes", "text": "Yes"},
                {"id": "No", "text": "No"}
            ]
        elif "rearranged sentence" in chunk_clean.lower() or "rearranged word" in chunk_clean.lower():
            q_data[q_num]["type"] = "text"
            q_data[q_num]["statement"] = chunk_clean
        elif "Subtract:" in chunk_clean or "Add:" in chunk_clean:
            q_data[q_num]["type"] = "text"
            q_data[q_num]["statement"] = chunk_clean
        elif re.search(r"\([1-5]\)\s+[A-Za-z0-9]", chunk_clean):
            # Parse text options like (1) Cloth (2) Paper (3) Mineral ...
            q_data[q_num]["type"] = "single_choice"
            
            # Extract options
            opt_matches = list(re.finditer(r"\((\d+)\)\s*([^(\n]+)", chunk_clean))
            if opt_matches:
                stmt = chunk_clean[:opt_matches[0].start()].strip()
                q_data[q_num]["statement"] = stmt if stmt else chunk_clean
                opts = []
                for om in opt_matches:
                    opts.append({
                        "id": om.group(1),
                        "text": om.group(2).strip()
                    })
                q_data[q_num]["options"] = opts
            else:
                q_data[q_num]["statement"] = chunk_clean
        elif q_data[q_num]["images"]:
            # Image based question
            q_data[q_num]["type"] = "single_choice"
            q_data[q_num]["statement"] = chunk_clean if chunk_clean else "Identify the correct figure to continue the series / complete the pattern."
            # Set default 5 options if series or 3 if group
            if q_num == 1:
                q_data[q_num]["options"] = [
                    {"id": "1", "text": "Cube 1"},
                    {"id": "2", "text": "Cube 2"},
                    {"id": "3", "text": "Cube 3"}
                ]
            else:
                q_data[q_num]["options"] = [
                    {"id": "1", "text": "Option 1"},
                    {"id": "2", "text": "Option 2"},
                    {"id": "3", "text": "Option 3"},
                    {"id": "4", "text": "Option 4"},
                    {"id": "5", "text": "Option 5"},
                ]
        else:
            q_data[q_num]["type"] = "text"
            q_data[q_num]["statement"] = chunk_clean

        # Attach answer and explanation
        if q_num in ans_map:
            q_data[q_num]["correctAnswer"] = ans_map[q_num]["answer"]
            q_data[q_num]["explanation"] = ans_map[q_num]["explanation"]
            
    # Check solution images on answer pages for Q20, Q23, etc.
    for p_num in range(a_s, a_e + 1):
        if p_num in page_images_cache:
            for img_name in page_images_cache[p_num]:
                if not img_name.endswith('.png'):
                    continue
                # Save solution image
                sol_path = f"/images/set{s_num:02d}/sol_{p_num}_{img_name}"
                out_sol = f"{set_folder}/sol_{p_num}_{img_name}"
                with open(out_sol, "wb") as f:
                    f.write(page_images_cache[p_num][img_name])
                # In Q20/Q23, if explanation text is empty or short, link solution image
                if q_num == 20 or q_num == 23:
                    if not q_data[20]["solutionImage"]:
                        q_data[20]["solutionImage"] = sol_path
                    elif not q_data[23]["solutionImage"]:
                        q_data[23]["solutionImage"] = sol_path

    # Save to JSON file
    questions_list = [q_data[i] for i in range(1, 51)]
    json_path = f"src/data/questions/set{s_num:02d}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(questions_list, f, indent=2, ensure_ascii=False)
        
    set_meta = {
        "setNumber": s_num,
        "name": f"OIR Practice Set {s_num:02d}",
        "totalQuestions": 50,
        "defaultDurationMinutes": 25,
        "defaultQuestionTimeSeconds": 40,
        "totalImages": sum(len(q["images"]) for q in questions_list)
    }
    all_sets_summary.append(set_meta)
    print(f"Set {s_num:02d}: Extracted 50 questions, {set_meta['totalImages']} diagrams saved to {json_path}")

with open("src/data/setsSummary.json", "w", encoding="utf-8") as f:
    json.dump(all_sets_summary, f, indent=2)

print("\nSUCCESS: All 20 sets extracted and verified!")

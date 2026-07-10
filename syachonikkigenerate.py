#!/usr/bin/env python3
"""
社長日記 HTML 生成スクリプト
使い方: python3 generate.py data/vol005.py
"""

import sys, os, re, base64
from pathlib import Path

# ─────────────────────────────────────────
# 1. 記法変換エンジン
# ─────────────────────────────────────────
def convert_markup(text: str) -> str:
    """
    独自記法 → HTML に変換する

    記法一覧:
      **太字**       → <span class="t-bold">太字</span>
      __下線__       → <span class="t-under">下線</span>
      ==マーカー==   → <span class="t-mark">マーカー</span>
      >> セリフ|サブ → quote-block（| でサブテキスト区切り、省略可）
      ## 見出し      → <h4>見出し</h4>
    """
    # ** 太字 **
    text = re.sub(r'\*\*(.+?)\*\*', r'<span class="t-bold">\1</span>', text)
    # __ 下線 __
    text = re.sub(r'__(.+?)__', r'<span class="t-under">\1</span>', text)
    # == マーカー ==
    text = re.sub(r'==(.+?)==', r'<span class="t-mark">\1</span>', text)
    # ## 見出し（行頭）
    text = re.sub(r'^## (.+)$', r'<h4>\1</h4>', text, flags=re.MULTILINE)
    # >> 引用ブロック（| でサブテキスト区切り、省略可）
    def quote_replace(m):
        parts = m.group(1).split('|', 1)
        main = parts[0].strip().replace('\n', '<br>')
        sub  = f'<span class="quote-sub">——{parts[1].strip()}——</span>' if len(parts) > 1 else ''
        return f'<div class="quote-block"><span class="quote-main">{main}</span>{sub}</div>'
    text = re.sub(r'^>> (.+?)(?=\n(?!>> )|\Z)', quote_replace, text, flags=re.MULTILINE | re.DOTALL)
    return text


# ─────────────────────────────────────────
# 2. 本文パーサー（セクション → HTML）
# ─────────────────────────────────────────
def parse_body(sections: list, photos: dict) -> str:
    """
    sections: [
      {
        "icon": "🍞",
        "heading": "見出しテキスト",
        "paragraphs": ["段落1テキスト", "段落2テキスト", ...],
        "photo_after": 0   # 段落番号の後に写真を挿入（省略=なし）
      },
      ...
    ]
    photos: {
      "photo1": {"path": "img/photo1.jpg", "caption": "キャプション"},
      "photo2": {...},
      ...
    }
    """
    html_parts = []
    photo_counter = 1

    for sec in sections:
        icon = sec.get("icon", "")
        heading = sec.get("heading", "")
        paragraphs = sec.get("paragraphs", [])
        photo_after = sec.get("photo_after", None)   # 何番目の段落の後に写真を挿入するか（0始まり）
        photo_key   = sec.get("photo_key", None)     # 使う写真キー（photo1〜photo4）

        lines = [f'  <section class="section">']
        if heading:
            lines.append(f'    <h3 class="section-heading"><span class="section-icon">{icon}</span>{heading}</h3>')
        lines.append(f'    <div class="section-body">')

        for i, para in enumerate(paragraphs):
            converted = convert_markup(para.strip())
            # quote-blockはそのまま（pタグで囲まない）
            if converted.strip().startswith('<div class="quote-block"') or \
               converted.strip().startswith('<h4>'):
                lines.append(f'      {converted}')
            else:
                lines.append(f'      <p>{converted}</p>')

            # 写真挿入タイミング
            if photo_after is not None and i == photo_after and photo_key:
                photo_info = photos.get(photo_key)
                if photo_info:
                    b64 = _load_photo(photo_info["path"])
                    cap = photo_info.get("caption", "")
                    lines.append(f'      <figure class="photo-block">')
                    lines.append(f'        <img src="data:image/jpeg;base64,{b64}" alt="{cap}">')
                    lines.append(f'        <figcaption>▲ {cap}</figcaption>')
                    lines.append(f'      </figure>')

        lines.append(f'    </div>')
        lines.append(f'  </section>')
        html_parts.append('\n'.join(lines))

    return '\n\n'.join(html_parts)


def _load_photo(path: str) -> str:
    """画像ファイルをBase64に変換"""
    from PIL import Image, ImageOps
    import io

    img = Image.open(path)
    img = ImageOps.exif_transpose(img)
    if img.width > 800:
        ratio = 800 / img.width
        img = img.resize((800, int(img.height * ratio)), Image.LANCZOS)
    img = img.convert('RGB')
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=75, optimize=True)
    return base64.b64encode(buf.getvalue()).decode()


# ─────────────────────────────────────────
# 3. HTML生成メイン
# ─────────────────────────────────────────
def generate(data: dict, template_path: str = None) -> str:
    """
    data に必要なキー:
      vol_number  : "005"
      date        : "2026.07.10"
      kicker      : "ルーツ編・その四"
      main_title  : "夢の扉をたたいた日"
      subtitle_en : "the day I knocked on the door of my dream"
      vol_id      : "syacho-nikki-vol005"   ← Firestore用キー
      sections    : [ ... ]  ← parse_body に渡す形式
      photos      : { "photo1": {...}, ... }
      chapter_end : "——  ルーツ編　続く  ——"  or ""
    """
    if template_path is None:
        template_path = Path(__file__).parent / "template.html"

    with open(template_path, 'r', encoding='utf-8') as f:
        tmpl = f.read()

    # 本文HTML生成
    body_html = parse_body(data.get("sections", []), data.get("photos", {}))

    # 章末
    chapter_end_text = data.get("chapter_end", "")
    chapter_end_html = ""
    if chapter_end_text:
        chapter_end_html = (
            '\n  <div class="ornament">'
            '\n    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">'
            '\n      <circle cx="9" cy="9" r="2"/><circle cx="2.5" cy="9" r="1.2"/><circle cx="15.5" cy="9" r="1.2"/>'
            '\n    </svg>'
            '\n  </div>'
            f'\n  <div class="chapter-end">{chapter_end_text}</div>'
        )

    # プレースホルダー置換
    replacements = {
        "{{vol_number}}":  data.get("vol_number", "???"),
        "{{date}}":        data.get("date", ""),
        "{{kicker}}":      data.get("kicker", ""),
        "{{main_title}}":  data.get("main_title", ""),
        "{{subtitle_en}}": data.get("subtitle_en", ""),
        "{{vol_id}}":      data.get("vol_id", f'syacho-nikki-vol{data.get("vol_number","000")}'),
        "{{body}}":        body_html,
        "{{chapter_end}}": chapter_end_html,
    }

    for key, val in replacements.items():
        tmpl = tmpl.replace(key, val)

    return tmpl


# ─────────────────────────────────────────
# 4. CLIエントリポイント
# ─────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("使い方: python3 generate.py data/vol005.py [出力先.html]")
        sys.exit(1)

    data_path = sys.argv[1]
    out_path  = sys.argv[2] if len(sys.argv) > 2 else None

    # データファイルをimport
    import importlib.util
    spec = importlib.util.spec_from_file_location("vol_data", data_path)
    mod  = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    data = mod.DATA

    html = generate(data)

    if out_path:
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(html)
        print(f"✅ 生成完了: {out_path}")
    else:
        print(html)

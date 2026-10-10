#!/usr/bin/env python3
"""Excel workbook for a TikTok snapshot folder.

    python export_xlsx.py out/<name>/<date> [--out report.xlsx]

The numbers come from report.js (collector.js logic over ads.csv + details.json
+ curation.json), so the workbook always follows the current report. Sheets:
Сводка, Объявления, Рекламодатели (Ad Library) or Топ по CTR (Creative Center),
Долгожители, Хуки, Таргетинг, Запросы and, when the files exist, Креативы (with
thumbnails if Pillow is installed) and Гипотезы.

Ad text is third-party data: a cell is always written as text, never as a
formula, and links are http(s) only. A link to a third-party site is clickable
without its query string (ttclid, utm_*: a click on those would be counted in
the competitor's analytics); the cell still shows the full link as text. Payer
names ("Ad paid for by", often a private person) are not stored at all: the
sheet only says whether the payer differs from the advertiser.
Needs openpyxl (pip install openpyxl); never installed by this script.
"""
import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).parent


def clean_url(u):
    """scheme://host/path of an http(s) link, without query and fragment; None otherwise."""
    try:
        x = urlsplit(str(u or ""))
    except ValueError:
        return None
    if x.scheme not in ("http", "https") or not x.hostname or x.username or x.password:
        return None
    return f"{x.scheme}://{x.netloc}{x.path}"


def payer_text(v):
    return "отличается" if v is True else ("совпадает" if v is False else "")

ROWS_JS = r"""
const C=require(process.argv[1]);const {loadSnapshot}=require(process.argv[2]);
const s=loadSnapshot(process.argv[3]);const country=s.meta.country||'';const now=s.meta.ts;
const rows=s.rows.map(r=>({...r,door:C.classifyDoor(r),run_days:C.runDays(r),active:C.isActive(r,now),objective_name:C.objectiveName(r.objective),url:C.adUrl(r,country),tracker:C.isTrackerLink(r.link)}));
const pages={};for(const r of rows){const p=pages[r.page]||(pages[r.page]={page:r.page,adv_id:r.adv_id||'',ads:0,active:0,longest:0,doors:new Set(),sites:new Set(),handle:'',followers:null,country:'',reach:''});
p.ads++;if(r.active)p.active++;p.longest=Math.max(p.longest,r.run_days||0);p.doors.add(r.door);if(r.door==='Сайт')p.sites.add(C.isTrackerLink(r.link)?'(через трекер)':C.domainOf(r.link));
if(!p.adv_id&&r.adv_id)p.adv_id=r.adv_id;if(!p.handle&&r.tt_handle)p.handle=r.tt_handle;if(r.tt_followers!==null&&r.tt_followers!==undefined)p.followers=Math.max(p.followers||0,r.tt_followers);
if(!p.country&&r.adv_country)p.country=r.adv_country;if(C.reachRank(r.reach)>C.reachRank(p.reach))p.reach=r.reach;}
const pageList=Object.values(pages).map(p=>({...p,doors:[...p.doors].join(', '),sites:[...p.sites].join(', '),url:C.advertiserUrl(p.adv_id,country)})).sort((a,b)=>b.ads-a.ads);
process.stdout.write(JSON.stringify({...s,rows,pages:pageList,cost_names:C.COST_NAMES,tag_names:Object.fromEntries(Object.entries(C.CREATIVE_TAGS).map(([k,t])=>[k,t.label]))}));
"""


def load(folder: Path) -> dict:
    try:
        res = subprocess.run(["node", "-e", ROWS_JS, str(HERE / "collector.js"), str(HERE / "report.js"), str(folder)],
                             capture_output=True, encoding="utf-8", timeout=180)
    except FileNotFoundError:
        sys.exit("Node.js is required (report.js builds the numbers).")
    if res.returncode != 0:
        sys.exit("report.js failed: " + res.stderr.strip()[:500])
    return json.loads(res.stdout)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Excel workbook for a TikTok snapshot folder.")
    ap.add_argument("folder")
    ap.add_argument("--out")
    args = ap.parse_args()
    folder = Path(args.folder)
    if not (folder / "ads.csv").exists():
        sys.exit(f"No ads.csv in {folder}")
    try:
        from openpyxl import Workbook
        from openpyxl.comments import Comment
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
    except ImportError:
        sys.exit("openpyxl is not installed: pip install openpyxl")

    d = load(folder)
    r, meta = d["report"], d["meta"]
    cc = r.get("source") == "cc"
    types = (meta.get("curation") or {}).get("types") or {}
    wb = Workbook()
    head_font, head_fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="C2185B")
    link_font = Font(color="1A56DB", underline="single")

    def text(cell, v):
        cell.value = v
        if isinstance(v, str):
            cell.data_type = "s"  # third-party text: never a formula

    def sheet(title, heads, rows, widths=None, links=None):
        ws = wb.create_sheet(title)
        for j, h in enumerate(heads, 1):
            c = ws.cell(row=1, column=j, value=h)
            c.font, c.fill = head_font, head_fill
        for i, row in enumerate(rows, 2):
            for j, v in enumerate(row, 1):
                if isinstance(v, (list, tuple)):
                    v = "; ".join(str(x) for x in v)
                text(ws.cell(row=i, column=j), v if v is not None else "")
        for col, url_of in (links or {}).items():
            for i, row in enumerate(rows, 2):
                u = url_of(i - 2)
                if isinstance(u, str) and u.startswith(("http://", "https://")):
                    c = ws.cell(row=i, column=col)
                    c.hyperlink, c.font = u, link_font
        for j, w in enumerate(widths or [], 1):
            ws.column_dimensions[get_column_letter(j)].width = w
        ws.freeze_panes = "A2"
        return ws

    # Сводка
    ws = wb.active
    ws.title = "Сводка"
    src = "TikTok Creative Center (Top Ads)" if cc else "TikTok Ad Library"
    lines = [("Источник", src), ("Страна", meta.get("country", "")), ("Дата", datetime.fromtimestamp(meta.get("ts", 0), timezone.utc).strftime("%Y-%m-%d")),
             ("Ниша / пресет", meta.get("preset_title") or meta.get("preset") or ""), ("Запросы", "; ".join(meta.get("queries") or [])), ("Объявлений", r["ads"])]
    if cc:
        lines += [("В топ-20% по CTR", r["ctr"]["top20"]), ("Медиана CTR-перцентиля", r["ctr"]["median_top"]), ("Медиана лайков", r["likes"]["median"]),
                  ("С посадочной", r["with_landing"]), ("Медиана длины, с", r["median_duration"])]
    else:
        hi = r["hypothesis_inputs"]
        lines += [("Уникальных текстов", r["unique_texts"]), ("Рекламодателей", r["advertisers"]), ("С одним объявлением", r["single_ad_advertisers"]),
                  (f"Показывались ≥ {hi['long_days']} дн. (уник.)", hi["long_running_ads"]), ("С деталями", r["targeting"]["ads_with_details"])]
    pr = r.get("prices") or {}
    lines += [("Объявлений с ценой", pr.get("ads_with_price")), (f"Медиана цены, {pr.get('currency', '')}", pr.get("median"))]
    for i, (k, v) in enumerate(lines, 1):
        ws.cell(row=i, column=1, value=k).font = Font(bold=True)
        text(ws.cell(row=i, column=2), v)
    i = len(lines) + 2
    ws.cell(row=i, column=1, value="Предупреждения").font = Font(bold=True, size=12)
    for w in d.get("warnings") or []:
        i += 1
        text(ws.cell(row=i, column=1), w["severity"])
        text(ws.cell(row=i, column=2), w["message"])
    i += 2
    ws.cell(row=i, column=1, value="Что ещё можно сделать").font = Font(bold=True, size=12)
    for s in d.get("next_steps") or []:
        i += 1
        text(ws.cell(row=i, column=1), ("СРОЧНО: " if s.get("urgent") else "") + s["title"])
        text(ws.cell(row=i, column=2), s["why"] + " " + s["how"])
    ws.column_dimensions["A"].width, ws.column_dimensions["B"].width = 34, 120
    for row in ws.iter_rows(min_col=2, max_col=2):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical="top")

    # Объявления
    rows = d["rows"]
    cost = d.get("cost_names") or {}
    heads = ["Ссылка на объявление", "Рекламодатель", "Тип", "Первый показ", "Последний показ", "Дней показа", "Активно (7 дн.)", "Охват", "Категория", "Цель", "CTA",
             "Куда ведёт", "Ссылка", "Текст", "Запросы", "CTR (перцентиль)", "Лайки", "Комментарии", "Репосты", "Бюджет", "Длина, с", "Возраст", "Пол", "Города", "Сужение",
             "TikTok", "Подписчики", "Страна рекламодателя", "Плательщик ≠ рекламодатель", "Обложка", "Видео"]
    day = lambda t: datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d") if t else ""
    data = [[r2["id"], r2["page"], types.get(r2["page"], ""), day(r2.get("start")), day(r2.get("last")), r2.get("run_days"), "да" if r2.get("active") else "нет",
             r2.get("reach"), r2.get("category"), r2.get("objective_name"), r2.get("cta"), r2["door"], r2.get("link"), r2.get("title"), r2.get("kws"),
             r2.get("ctr_top"), r2.get("likes"), r2.get("comments"), r2.get("shares"), cost.get(str(r2.get("cost_level")), "") if r2.get("cost_level") is not None else "",
             r2.get("duration"), r2.get("ages"), r2.get("genders"), r2.get("target_cities"), r2.get("targeting_used"), r2.get("tt_handle"), r2.get("tt_followers"),
             r2.get("adv_country"), payer_text(r2.get("payer_differs")), "обложка" if r2.get("image_url") else "", "видео" if r2.get("video_url") else ""] for r2 in rows]
    ws = sheet("Объявления", heads, data, [20, 26, 14, 12, 12, 8, 8, 10, 18, 16, 14, 14, 30, 60, 20, 8, 8, 8, 8, 9, 8, 22, 12, 20, 18, 16, 10, 14, 18, 9, 9],
               {1: lambda k: rows[k]["url"], 13: lambda k: None if rows[k].get("tracker") else clean_url(rows[k].get("link")), 30: lambda k: rows[k].get("image_url"), 31: lambda k: rows[k].get("video_url")})
    ws.cell(row=1, column=29).comment = Comment("Имя плательщика не сохраняется (может быть частным лицом). Показано только, отличается ли плательщик от рекламодателя: так выглядят агентства и сети страниц.", "tiktok-ads-niche-report")
    ws.cell(row=1, column=30).comment = Comment("Ссылки TikTok на медиа подписаны и живут часы–дни: открыть или скачать сразу.", "tiktok-ads-niche-report")

    if not cc:
        pages = d["pages"]
        sheet("Рекламодатели", ["Рекламодатель", "Тип", "Объявл.", "Активных", "Дольше всего, дн.", "Охват (макс.)", "Куда ведёт", "Сайты", "TikTok", "Подписчики", "Страна"],
              [[p["page"], types.get(p["page"], ""), p["ads"], p["active"], p["longest"], p["reach"], p["doors"], p["sites"], p["handle"], p["followers"], p["country"]] for p in pages],
              [30, 14, 8, 8, 10, 12, 24, 30, 18, 10, 14], {1: lambda k: pages[k]["url"]})
        lr = r.get("longrun") or []
        sheet("Долгожители", ["Рекламодатель", "Дней показа", "Активно", "Копий", "Охват", "Цель", "Куда ведёт", "Текст"],
              [[x["page"], x["run_days"], "да" if x["active"] else "нет", x["copies"], x["reach"], x["objective"], x["door"], x["text"]] for x in lr],
              [28, 10, 8, 8, 10, 16, 14, 80], {8: lambda k: lr[k]["url"]})
        t = r.get("targeting") or {}
        if t.get("ads_with_details"):
            trows = [["Объявлений с деталями", t["ads_with_details"]]] + [["Возраст " + k, v] for k, v in (t.get("age_bands") or {}).items()]
            trows += [["Только женщины", t["gender"]["female_only"]], ["Только мужчины", t["gender"]["male_only"]], ["Все", t["gender"]["both"]]]
            trows += [["Сужение: " + k, v] for k, v in (t.get("options_used") or {}).items()] + [["Город: " + c["value"], c["share"]] for c in t.get("top_cities") or []]
            sheet("Таргетинг", ["Показатель", "Значение"], trows, [40, 14])
    else:
        top = r.get("top_by_ctr") or []
        sheet("Топ по CTR", ["CTR (перцентиль)", "Лайки", "Бюджет", "Длина, с", "Подотрасль", "Цель", "Куда ведёт", "Посадочная", "Текст"],
              [[x["ctr_top"], x["likes"], cost.get(str(x["cost_level"]), ""), x["duration"], x["category"], x["objective"], x["door"], x.get("link") or "", x["text"]] for x in top],
              [10, 9, 9, 8, 22, 16, 12, 30, 80], {9: lambda k: top[k]["url"], 8: lambda k: clean_url(top[k].get("link"))})

    hi = r["hypothesis_inputs"]
    hrows = [["частота", k, v, "", "", "", ""] for k, v in sorted(r["hook_freq"].items(), key=lambda x: -x[1])]
    hrows += [["чаще у победителей", h["hook"], h["winner_ads"], h["lift"], h["strength"], h["advertisers"], "; ".join(e["url"] for e in h.get("examples") or [])] for h in hi.get("winner_hooks") or []]
    hrows += [["почти не используют", h["hook"], h["ads"], "", "", h["advertisers"], "круговой" if h.get("circular") else ""] for h in hi.get("underused_hooks") or []]
    sheet("Хуки", ["Блок", "Хук", "Объявл.", "Lift", "Сила сигнала", "Рекламодателей", "Примеры / пометка"], hrows, [20, 26, 9, 7, 12, 14, 90])

    qs = d.get("query_stats") or []
    sheet("Запросы", ["Запрос", "Собрано", "Всего в выдаче", "Рекламодателей", "Из них конкуренты", "Неполно"],
          [[q["query"], q["ads"], q["library_total"], q["advertisers"], q["relevant_advertisers"], "да" if q["capped"] else ""] for q in qs], [30, 9, 12, 12, 14, 9])

    vis = d.get("visuals")
    if vis and vis.get("items"):
        tag_names = d.get("tag_names") or {}
        fields = list(tag_names.keys())
        items = vis["items"]
        ws = sheet("Креативы", ["Миниатюра", "Рекламодатель", "Дней / CTR", "Победитель", "Хук (текст)"] + [tag_names[f] for f in fields] + ["Заметки", "Объявление"],
                   [["", g["page"], g["days"] if g.get("days") else g.get("ctr_top"), "да" if g.get("winner") else "", g.get("hook_text", "")]
                    + [(g.get("tag_names") or {}).get(f, "") for f in fields] + [g.get("notes", ""), "открыть"] for g in items],
                   [26, 22, 9, 9, 30] + [16] * len(fields) + [40, 10], {6 + len(fields) + 1: lambda k: items[k]["url"]})
        try:
            from openpyxl.drawing.image import Image as XLImage
            import PIL  # noqa: F401  (openpyxl embeds pictures through Pillow)
            root = folder.resolve()
            for k, g in enumerate(items, 2):
                rel = (g.get("thumbs") or g.get("files") or [None])[0]
                if not rel:
                    continue
                f = (folder / rel).resolve()
                if root not in f.parents or not f.exists():
                    continue
                img = XLImage(str(f))
                scale = 120 / max(img.height, 1)
                img.width, img.height = int(img.width * scale), 120
                ws.add_image(img, f"A{k}")
                ws.row_dimensions[k].height = 95
        except ImportError:
            pass

    hyp_path = folder / "hypotheses.json"
    if hyp_path.exists():
        hyps = json.loads(hyp_path.read_text(encoding="utf-8"))
        lint = {}
        if (folder / "hypotheses_lint.json").exists():
            lint = {x["name"]: x for x in json.loads((folder / "hypotheses_lint.json").read_text(encoding="utf-8")).get("results", [])}
        keys = ["name", "evidence_strength", "hook", "angle", "evidence", "hook_line", "scenario", "primary_text", "cta", "destination", "format", "test", "metric", "risk", "confirm_with_client"]
        names = ["Название", "Сила сигнала", "Хук", "Угол", "Свидетельство", "Хук первых 2 с", "Сценарий", "Текст объявления", "CTA", "Куда ведёт", "Формат", "Что тестируем", "Метрика", "Риски", "Подтвердить у клиента", "Автопроверка"]
        sheet("Гипотезы", names, [[h.get(k, "") for k in keys] + [("; ".join(f"[{f['severity']}] {f['message']}" for f in lint[h.get('name')]["findings"]) if h.get("name") in lint else "")] for h in hyps],
              [24, 10, 16, 30, 40, 30, 40, 40, 12, 18, 18, 24, 14, 24, 30, 50])

    plan_path = folder / "test_plan.json"
    if plan_path.exists():
        tp = json.loads(plan_path.read_text(encoding="utf-8"))
        prow = [["рейтинг", x["rank"], x["name"], x["variable_type"], x["evidence_strength"], x["effort"], x["score"], "; ".join(x["blockers"])] for x in tp.get("ranked", [])]
        pl = tp.get("plan") or {}
        prow += [["раунд", r["round"], "; ".join(t["name"] for t in r["tests"]), "; ".join(t["variable_type"] for t in r["tests"]), "", "", r["budget"], ""] for r in pl.get("rounds", [])]
        a = pl.get("assumptions") or {}
        prow += [["допущения", "", f"{a.get('variants_per_test')} варианта × {a.get('events_per_variant')} событий × CPA {a.get('target_cpa')}; ≥ {a.get('min_days_per_round')} дн. на раунд; обновлять ролики каждые {a.get('creative_refresh_days')} дн.", "", "", "", a.get("per_test_budget"), ""]]
        sheet("План тестов", ["Блок", "№", "Гипотеза / тесты", "Тип переменной", "Сила", "Трудоёмк.", "Балл / бюджет", "Блокеры"], prow, [12, 6, 50, 18, 10, 9, 12, 40])

    sites_path = folder / "sites.json"
    if sites_path.exists():
        sites = json.loads(sites_path.read_text(encoding="utf-8"))
        def pixel(s):
            px = s.get("pixels") or {}
            return "да" if px.get("tiktok") else ("возможно, через GTM" if px.get("tag_manager") else "не найден")
        srows = [[s["page"], s.get("ads"), s.get("final_url") or s.get("landing"), s.get("error", ""), s.get("title", ""), pixel(s) if not s.get("error") else "",
                  ("да" if (s.get("pixels") or {}).get("meta") else "") if not s.get("error") else "",
                  (s.get("site") or {}).get("prices", {}).get("min"), (s.get("site") or {}).get("prices", {}).get("max"),
                  ", ".join((s.get("compare") or {}).get("promised_not_on_site", [])), ", ".join((s.get("compare") or {}).get("on_site_not_advertised", []))] for s in sites]
        sheet("Сайты", ["Рекламодатель", "Объявл.", "Страница", "Ошибка / пропуск", "Заголовок", "Пиксель TikTok", "Пиксель Meta", "Цена мин.", "Цена макс.", "Обещано, на сайте нет", "На сайте, в рекламе нет"],
              srows, [26, 8, 40, 30, 30, 14, 10, 9, 9, 30, 30], {3: lambda k: None if sites[k].get("error") else clean_url(sites[k].get("final_url") or sites[k].get("landing"))})

    diff_path = folder / "diff.json"
    if diff_path.exists():
        df = json.loads(diff_path.read_text(encoding="utf-8"))
        drows = []
        if df.get("source") == "cc":
            drows += [["итог", f"{df['prev_ads']} → {df['curr_ads']}; остались {df['kept']}, вошли {df['entered']['count']}, выпали {df['dropped']['count']}", "", ""]]
            drows += [["вошло в топ", x["text"], x["ctr_top"], x["url"]] for x in df["entered"]["top"]]
        else:
            drows += [["итог", f"{df['interval_days']} дн.; роликов {df['prev_creatives']} → {df['curr_creatives']}; новых {df['new_creatives']['count']}; выключено {len(df['stops']['stopped_creatives'])}; молодых тестов выключено {df['young_tests']['gone']} из {df['young_tests']['creatives']}", "", ""]]
            drows += [["масштабируют", f"{x['page']}: {x['text']}", f"{x['copies_prev']} → {x['copies_curr']} копий", x["url"]] for x in df["scaling"]]
            drows += [["выключили", f"{x['page']}: {x['text']}", f"{x['run_days']} дн.", x["url"]] for x in df["stops"]["stopped_creatives"]]
            drows += [["новый рекламодатель", f"{x['page']}: {x['example']}", ", ".join(x["hooks"]), x["url"]] for x in df["dynamics"]["new_entrants"]]
            drows += [["не размечен", x["page"], x["ads"], ""] for x in df.get("unreviewed_pages") or []]
        sheet("Изменения", ["Блок", "Что", "Значение", "Ссылка"], drows, [20, 90, 18, 50], {4: lambda k: drows[k][3]})

    out = Path(args.out) if args.out else folder / "report.xlsx"
    wb.save(out)
    print(f"Saved: {out}")


if __name__ == "__main__":
    main()

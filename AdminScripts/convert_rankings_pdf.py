"""Convert NFL26_CS_PPR.pdf into the DraftBoard rankings data file.

Run from the repository root:
  python AdminScripts/convert_rankings_pdf.py

Requires: pdfplumber
"""

import json
import re
from pathlib import Path

import pdfplumber


PDF_PATH = Path(__file__).parent.parent / "NFL26_CS_PPR.pdf"
OUTPUT_PATH = Path(__file__).parent.parent / "DraftBoard" / "rankings-data.js"
COLUMN_BOUNDS = [
    (18, 55, 146, 705),
    (151, 55, 290, 705),
    (293, 55, 428, 705),
    (431, 55, 575, 650),
]
POSITION_HEADERS = {
    "Quarterbacks": "QB",
    "Running Backs": "RB",
    "Wide Receivers": "WR",
    "Tight Ends": "TE",
    "Team Defenses": "DEF",
    "Kickers": "K",
}
DEFENSE_TEAMS = {
    "Texans": "HOU", "Broncos": "DEN", "Steelers": "PIT", "Seahawks": "SEA",
    "Rams": "LAR", "Ravens": "BAL", "Eagles": "PHI", "Browns": "CLE",
    "Patriots": "NE", "Lions": "DET", "Chiefs": "KC", "Chargers": "LAC",
    "Buccaneers": "TB", "Packers": "GB", "Jaguars": "JAC",
}
PLAYER_PATTERN = re.compile(r"^(\d+)\. \((\d+)\) (.+), ([A-Z]+) \$(\d+) (\d+)$")
DEFENSE_PATTERN = re.compile(r"^(\d+)\. \((\d+)\) (.+?) \(Wk 1:.*\) \$(\d+) (\d+)$")


def position_for_header(line):
    for header, position in POSITION_HEADERS.items():
        if line.startswith(header):
            return position
    return None


def parse_column(text):
    position = None
    rows = []
    for line in text.splitlines():
        if line.startswith("Bye Weeks"):
            break
        header_position = position_for_header(line)
        if header_position:
            position = header_position
            continue
        if not position:
            continue
        player_match = PLAYER_PATTERN.match(line)
        defense_match = DEFENSE_PATTERN.match(line) if position == "DEF" else None
        if player_match:
            positional_rank, overall_rank, name, team, value, bye_week = player_match.groups()
        elif defense_match:
            positional_rank, overall_rank, name, value, bye_week = defense_match.groups()
            team = DEFENSE_TEAMS[name.split()[0]]
        else:
            continue
        rows.append({
            "rank": int(positional_rank),
            "overallRank": int(overall_rank),
            "name": name,
            "team": team,
            "position": position,
            "value": int(value),
            "byeWeek": int(bye_week),
        })
    return rows


def main():
    with pdfplumber.open(PDF_PATH) as pdf:
        page = pdf.pages[0]
        rankings = []
        for bounds in COLUMN_BOUNDS:
            rankings.extend(parse_column(page.within_bbox(bounds).extract_text() or ""))

    rankings.sort(key=lambda row: ("QB RB WR TE DEF K".split().index(row["position"]), row["rank"]))
    OUTPUT_PATH.write_text(
        "// Generated from NFL26_CS_PPR.pdf by AdminScripts/convert_rankings_pdf.py\n"
        f"const RANKINGS = {json.dumps(rankings, separators=(',', ':'))};\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(rankings)} rankings to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()

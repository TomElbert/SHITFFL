"""Export active fantasy players from Sleeper to a draft-ranking CSV.

Run from the repository root:
  python AdminScripts/export_available_players_csv.py

Use --output to choose another destination. Sleeper supplies player metadata
but not rank or tier values, so RK and TIERS are intentionally blank.
"""

import argparse
import csv
from pathlib import Path

import requests


SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"
FANTASY_POSITIONS = {"QB", "RB", "WR", "TE", "K", "DEF"}
POSITION_ORDER = {"QB": 1, "RB": 2, "WR": 3, "TE": 4, "K": 5, "DEF": 6}

# Official 2026 NFL bye weeks. The Sleeper player endpoint does not include a
# reliable current-season bye field, so this matches DraftBoard's player sync.
BYE_WEEKS = {
    "CAR": 5, "KC": 5,
    "CIN": 6, "DET": 6, "MIA": 6, "MIN": 6,
    "BUF": 7, "JAX": 7, "LAC": 7, "WAS": 7,
    "HOU": 8, "NO": 8, "NYG": 8, "SF": 8,
    "PIT": 9, "TEN": 9,
    "CHI": 10, "DEN": 10, "PHI": 10, "TB": 10,
    "ATL": 11, "CLE": 11, "GB": 11, "LAR": 11, "NE": 11, "SEA": 11,
    "BAL": 13, "IND": 13, "LV": 13, "NYJ": 13,
    "ARI": 14, "DAL": 14,
}


def parse_args():
    parser = argparse.ArgumentParser(description="Export Sleeper NFL players to a draft CSV.")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).with_name("draft_players.csv"),
        help="CSV destination (default: AdminScripts/draft_players.csv)",
    )
    return parser.parse_args()


def format_player(player_id, player):
    position = player.get("position")
    fantasy_positions = player.get("fantasy_positions") or []
    if not position and "DEF" in fantasy_positions:
        position = "DEF"

    is_active = player.get("active")
    if position not in FANTASY_POSITIONS or is_active is False:
        return None

    team = player.get("team") or "FA"
    name = f"{player.get('first_name') or ''} {player.get('last_name') or ''}".strip()
    if position == "DEF":
        name = name or team or str(player_id)
    if not name:
        return None

    return {
        "RK": "",
        "TIERS": "",
        "PLAYER NAME": name,
        "TEAM": team,
        "POS": position,
        "BYEWEEK": BYE_WEEKS.get(team, ""),
    }


def main():
    args = parse_args()
    try:
        response = requests.get(SLEEPER_PLAYERS_URL, timeout=30)
        response.raise_for_status()
    except requests.RequestException as error:
        raise SystemExit(f"Could not fetch Sleeper player data: {error}") from error

    rows = [
        row
        for player_id, player in response.json().items()
        if (row := format_player(player_id, player)) is not None
    ]
    rows.sort(key=lambda row: (POSITION_ORDER[row["POS"]], row["PLAYER NAME"].casefold()))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="", encoding="utf-8-sig") as output_file:
        writer = csv.DictWriter(
            output_file,
            fieldnames=["RK", "TIERS", "PLAYER NAME", "TEAM", "POS", "BYEWEEK"],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"Exported {len(rows)} active fantasy players to {args.output}")


if __name__ == "__main__":
    main()

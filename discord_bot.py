"""
Excelarated Cloud-Ready Discord Bot
Can be hosted 24/7 on free cloud services (like Render, Railway, or Replit) without your laptop running.
Uses the Discord Channel itself as the database (scans channel history for spreadsheets on startup),
and features a simplified `!watch` numbering selector.
"""
import os
import re
import sys
import json
import discord
from discord.ext import commands
import pandas as pd
import numpy as np
from datetime import datetime

# ── Paths ────────────────────────────────────────────────
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH  = os.path.join(PROJECT_ROOT, "config.json")
DATA_DIR     = os.path.join(PROJECT_ROOT, "data_cache")
os.makedirs(DATA_DIR, exist_ok=True)

# ── Load Config ──────────────────────────────────────────
def load_config() -> dict:
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_config(config: dict):
    try:
        with open(CONFIG_PATH, "w") as f:
            json.dump(config, f, indent=2)
    except Exception as e:
        print(f"Error saving config: {e}")

config = load_config()

# ── Discord Bot Setup ─────────────────────────────────────
intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents, help_command=None)

# Pre-loaded DataFrames in memory
df_cache = {}
available_files = []  # List of dicts: {"name": str, "path": str, "rows": int}
active_file = config.get("active_file", "") # Active working file

# ── Cache Loader ──────────────────────────────────────────
def load_file_to_cache(filepath: str):
    filename = os.path.basename(filepath)
    ext = os.path.splitext(filename)[1].lower()
    try:
        if ext in [".xlsx", ".xls"]:
            df = pd.read_excel(filepath)
        else:
            df = pd.read_csv(filepath)
        df_cache[filename] = df
        
        # Add to available list if not present
        if not any(f["name"] == filename for f in available_files):
            available_files.append({
                "name": filename,
                "path": filepath,
                "rows": len(df)
            })
        print(f"Cached {filename} ({len(df)} rows)")
    except Exception as e:
        print(f"Error caching {filename}: {e}")

async def sync_channel_history(channel):
    """
    Scans the channel's message history to find all uploaded spreadsheets,
    downloads them to the server, and indexes them. 
    This enables persistent memory on cloud servers!
    """
    print("Syncing channel history for spreadsheets...")
    df_cache.clear()
    available_files.clear()
    
    count = 0
    async for msg in channel.history(limit=200):
        if msg.attachments:
            for attachment in msg.attachments:
                ext = os.path.splitext(attachment.filename)[1].lower()
                if ext in [".xlsx", ".xls", ".csv"]:
                    # Skip duplicate newer versions if already downloaded
                    filepath = os.path.join(DATA_DIR, attachment.filename)
                    if not os.path.exists(filepath):
                        await attachment.save(filepath)
                    load_file_to_cache(filepath)
                    count += 1
    print(f"Sync complete. Indexed {count} files.")

# ── Date parsing helper ───────────────────────────────────
MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6,
    "july": 7, "jul": 7, "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
}

def parse_date_timeline(query: str) -> tuple:
    ql = query.lower()
    now = datetime.now()

    m = re.search(r"last\s+(\d+)\s+(day|week|month|year)s?", ql)
    if m:
        n = int(m.group(1))
        unit = m.group(2)
        days = {"day": 1, "week": 7, "month": 30, "year": 365}[unit]
        start = now - pd.Timedelta(days=n * days)
        return start, now

    from_match = re.search(r"from\s+([a-z0-9\s\-\/]+?)(?:\s+to|\s+until|\s+and|\s+till|$)", ql)
    to_match = re.search(r"to\s+([a-z0-9\s\-\/]+?)(?:\s+$|\s*[,;]|$)", ql)

    def parse_fuzzy(s: str):
        s = s.strip()
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"):
            try:
                return pd.to_datetime(s, format=fmt)
            except ValueError:
                pass
        pm = re.match(r"([a-z]+)\s+(\d{4})", s)
        if pm:
            month = MONTHS.get(pm.group(1))
            if month:
                return pd.Timestamp(int(pm.group(2)), month, 1)
        return None

    start = parse_fuzzy(from_match.group(1)) if from_match else None
    end = parse_fuzzy(to_match.group(1)) if to_match else None
    return start, end

# ── Dynamic Filter Engine ─────────────────────────────────
def process_discord_query(query: str) -> tuple:
    global active_file
    if not df_cache:
        return (
            "⚠️ No files loaded. Please upload a spreadsheet (`.xlsx` or `.csv`) directly to this channel first!",
            None,
            None,
        )

    # If an active file is selected, filter from that. Otherwise combine all.
    parts = []
    if active_file and active_file in df_cache:
        parts.append(df_cache[active_file].copy())
        source_desc = f"`{active_file}`"
    else:
        # Fallback to combining all files
        for fname, fdf in df_cache.items():
            fdf = fdf.copy()
            fdf["__source_file__"] = fname
            parts.append(fdf)
        source_desc = "all indexed files"

    if not parts:
        return "⚠️ Selected active file could not be read.", None, None

    df = pd.concat(parts, ignore_index=True)
    orig_cols = [c for c in df.columns if c != "__source_file__"]

    # 1. Date Filters
    start_date, end_date = parse_date_timeline(query)
    date_cols = [c for c in df.columns if any(w in c.lower() for w in ["date", "time", "timeline", "created", "outage"])]
    if (start_date or end_date) and date_cols:
        col = date_cols[0]
        try:
            df[col] = pd.to_datetime(df[col], errors="coerce")
            if start_date:
                df = df[df[col] >= start_date]
            if end_date:
                df = df[df[col] <= end_date]
        except Exception:
            pass

    # 2. Fuzzy Filter Terms
    tokens = [t.lower().strip() for t in query.split() if len(t) > 2]
    ignore = {"total", "sum", "average", "count", "make", "excel", "sheet", "outage", "outages", "with", "reason", "reasons", "timeline", "list", "from", "for"}
    search_terms = [t for t in tokens if t not in ignore]

    for term in search_terms:
        filtered = False
        for col in orig_cols:
            matches = df[df[col].astype(str).str.lower().str.contains(term, na=False)]
            if not matches.empty:
                df = matches
                filtered = True
                break
        if not filtered:
            row_str = df.astype(str).apply(lambda x: " ".join(x), axis=1).str.lower()
            df = df[row_str.str.contains(term, na=False)]

    if df.empty:
        return f"🔍 I found no matching rows in {source_desc} for your query.", None, None

    # 3. Generate Output Filename
    name_match = re.search(r"(?:called|named|save as|file name)\s+[\"']?([a-zA-Z0-9_ \-]+)[\"']?", query, re.IGNORECASE)
    base_name = name_match.group(1).strip().replace(" ", "_") if name_match else f"excelarated_output_{datetime.now().strftime('%Y%m%d_%H%M')}"
    if not base_name.endswith(".xlsx"):
        base_name += ".xlsx"

    cleaned_df = df.drop(columns=["__source_file__"], errors="ignore")

    # 4. Build Response
    ans = f"✅ **Processed Data from {source_desc}!**\n"
    ans += f"• Rows matching: **{len(cleaned_df):,}**\n"
    
    ans += "\n**Preview (first 8 rows):**\n```\n"
    cols_to_show = orig_cols[:5]
    preview_df = cleaned_df[cols_to_show].head(8)
    ans += preview_df.to_string(index=False)
    ans += "\n```"

    return ans, cleaned_df, base_name

# ── Discord Events & Commands ─────────────────────────────
@bot.event
async def on_ready():
    print(f"\n{'='*60}")
    print(f"  EXCELARATED CLOUD DISCORD BOT IS RUNNING!")
    print(f"  Logged in as: {bot.user.name}")
    print(f"{'='*60}\n")

@bot.event
async def on_message(message):
    if message.author == bot.user:
        return

    # Trigger scan of channel on the very first message if memory is empty
    if not df_cache:
        await sync_channel_history(message.channel)

    # Process command prefixes (like !watch)
    await bot.process_commands(message)

    content = message.content.strip()
    if not content or content.startswith("!"):
        return

    # If attachment uploaded
    if message.attachments:
        for attachment in message.attachments:
            ext = os.path.splitext(attachment.filename)[1].lower()
            if ext in [".xlsx", ".xls", ".csv"]:
                await message.channel.send(f"📥 **Downloading & indexing file:** `{attachment.filename}`...")
                filepath = os.path.join(DATA_DIR, attachment.filename)
                await attachment.save(filepath)
                load_file_to_cache(filepath)
                
                # Automatically set newly uploaded file as active
                global active_file
                active_file = attachment.filename
                config["active_file"] = active_file
                save_config(config)
                await message.channel.send(f"🎯 **Active file set to:** `{active_file}`")
        return

    # Process query
    async with message.channel.typing():
        response_text, df, out_filename = process_discord_query(content)
        await message.channel.send(response_text)

        if df is not None and out_filename:
            out_path = os.path.join(DATA_DIR, out_filename)
            df.to_excel(out_path, index=False)
            await message.channel.send(
                content="Here is your filtered Excel report! 📊",
                file=discord.File(out_path)
            )

# ── Simple Watch Command ──────────────────────────────────
@bot.command(name="watch")
async def watch_selection(ctx, number: int = None):
    """
    Shows a numbered list of all uploaded spreadsheets in the server.
    User selects which file to target by typing `!watch <number>`
    """
    global active_file
    
    # Sync first to ensure we have everything
    await sync_channel_history(ctx.channel)

    if not available_files:
        return await ctx.send("⚠️ No spreadsheets found in this channel yet. Upload some files first!")

    if number is None:
        # List all available files
        msg = "📊 **Available Excel/CSV Files in this Server:**\n"
        for idx, f in enumerate(available_files, start=1):
            active_marker = " 🎯 (ACTIVE)" if f["name"] == active_file else ""
            msg += f"**[{idx}]** `{f['name']}` — {f['rows']:,} rows{active_marker}\n"
        msg += "\n👉 Type **`!watch <number>`** to select which file you want me to work on!"
        msg += "\n*(Type `!watch 0` to work on all files combined)*"
        return await ctx.send(msg)

    # Set selection
    if number == 0:
        active_file = ""
        config["active_file"] = ""
        save_config(config)
        return await ctx.send("🎯 **Set to work on ALL uploaded files combined.**")

    if number < 1 or number > len(available_files):
        return await ctx.send(f"❌ Invalid selection. Choose a number between 1 and {len(available_files)}")

    selected = available_files[number - 1]
    active_file = selected["name"]
    config["active_file"] = active_file
    save_config(config)
    await ctx.send(f"🎯 **Active file set to:** `{active_file}`. All questions will now target this file!")

# ── Start Bot ─────────────────────────────────────────────
if __name__ == "__main__":
    token = config.get("token")
    if not token:
        if len(sys.argv) > 1:
            token = sys.argv[1]
        else:
            token = input("Please paste your Discord Bot Token here: ").strip()
        
        if token:
            config["token"] = token
            save_config(config)

    if token:
        try:
            bot.run(token)
        except Exception as e:
            print(f"Error starting bot: {e}")

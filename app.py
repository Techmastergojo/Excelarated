import os
import threading
import subprocess
import sys
import gradio as gr

# ── Start Discord Bot in a Background Thread ────────────────
def run_discord_bot():
    print("Starting Excelarated Discord Bot...")
    # Run discord_bot.py as a subprocess
    subprocess.run([sys.executable, "discord_bot.py"])

# Start the bot thread
threading.Thread(target=run_discord_bot, daemon=True).start()

# ── Simple Gradio UI ──────────────────────────────────────
with gr.Blocks(title="Excelarated Status") as demo:
    gr.Markdown("# ⚡ Excelarated AI Discord Bot")
    gr.Markdown("### Status: **ACTIVE & RUNNING 24/7**")
    gr.Markdown(
        "The Excelarated AI Bot is running in this Hugging Face Space. "
        "Your Dad can chat with it directly on Discord from his phone or desktop!"
    )
    gr.Markdown("---")
    gr.Markdown(
        "💡 *Note: You can close this Hugging Face browser tab. The bot will continue running "
        "permanently in the background of this Space for free.*"
    )

if __name__ == "__main__":
    demo.launch()

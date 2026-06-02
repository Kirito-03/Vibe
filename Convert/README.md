---
title: Youtube Downloader
emoji: 🦀
colorFrom: pink
colorTo: gray
sdk: gradio
sdk_version: 6.0.2
python_version: 3.11.5
app_file: app.py
pinned: false
---
# <span style='display: flex; align-items: center; gap: 10px;'><img src='https://cdn-icons-png.flaticon.com/512/1384/1384060.png' width='25'/> <img src='https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Youtube_Music_icon.svg/2048px-Youtube_Music_icon.svg.png' width='25'/>YouTube Downloader</span>

This application uses 
- [`yt_dlp`](https://github.com/yt-dlp/yt-dlp) - For downloading Audio/Video from YouTube and YoutTube Music.
- [`gradio`](https://www.gradio.app/) from HF - For UI.
- [`ffmpeg`](https://ffmpeg.org/) - For audio/video conversion and post-processing.

![Gradio UI screenshot - Sample 1](attachments/gradio-ui-screenshot-sample-1.png)

# Running locally
## Installation
- First, install `python 3.11.5` (preferrably in a virtual environment).
- **Install ffmpeg** (required for audio/video conversion):
  - **macOS**: `brew install ffmpeg`
  - **Linux (Ubuntu/Debian)**: `sudo apt-get install ffmpeg`
  - **Windows**: Download from [ffmpeg.org](https://ffmpeg.org/download.html) or use `choco install ffmpeg` (if Chocolatey is installed)
- Then, install Python dependencies by running `pip install -r requirements.txt` 

## Start the service
```
gradio app.py # For iterative developments
```
or
```
python app.py
```

## View in browser
Hit the browser at http://127.0.0.1:7860/

# Running in Hugging Face Spaces
## Cookies setup details
> [!NOTE] 
> If running locally, the code will work right away. This setup is only needed if running in hugging face (HF) spaces or other deployments to avoid bot related errors as shown below. 
```
ERROR - Download error: AAq06bS8UZM: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication. See  https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp  for how to manually pass cookies. Also see  https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies  for tips on effectively exporting YouTube cookies
 ```

> [!WARNING]
> Using this approach in publicly deployed services is discouraged, as the YouTube algorithm may disable the entire YouTube account from which the cookies are downloaded after continued use.

1. **Download the YouTube Cookies locally**
   - Follow the instruction provided [here](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies) to download the YouTube cookies.
   - Rename the downloaded cookie as `cookies.firefox-private.txt` and place it in the current working directory
2. **Convert cookie file content to `.env` file locally**
    - Simple copy paste will not work due to special characters
    - So, we will use the `cookies_to_env` function.
      - Uncomment the `# Convert cookie file to env and save locally`  section and run the code
    - Remember to comment the code once the `.env` file is updated.
3. **Set up or Update the Secrets in HF**
   - Copy the `.env` content (only the value, and not the key) and paste it inside the HF Secrets (Private) > `FIREFOX_COOKIES` in Hugging Face space.
4. **Deploy the changes to HF space, and Voila!**

## `.env` file structure
```
FIREFOX_COOKIES="<Formatted_Cookie_Content_Goes_Here>"
USE_FIREFOX_COOKIES="False" # Set to "True" to use cookies
```

## Additional resources
- Check out the configuration (and README metadata) reference [here](https://huggingface.co/docs/hub/spaces-config-reference)

# Potential Improvements
- [ ] Making the code async.
- [ ] Add support for playlists.
- [ ] Overcome youtube bot issue for publicly deployed service.
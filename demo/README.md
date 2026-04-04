# Demo Recording

The README demo video is recorded with [VHS](https://github.com/charmbracelet/vhs), converted to MP4 with ffmpeg, and hosted as a GitHub Release asset (not checked into git).

## Re-record and upload

```bash
make gh-demo    # records GIF → converts to MP4 → uploads to latest release
```

Requires `vhs` and `ffmpeg` (`brew install vhs ffmpeg`).

## Manual steps

```bash
vhs demo/demo.tape                     # generates demo/demo.gif
ffmpeg -y -i demo/demo.gif \           # converts to MP4
  -movflags faststart -pix_fmt yuv420p \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" demo/demo.mp4
gh release upload v<VERSION> demo/demo.mp4 --clobber
```

Then update the `<video>` tag URL in `README.md` if the version changed.

## Files

- `demo.tape` — VHS script (checked in, edit to change the demo)
- `demo.gif` — intermediate output (gitignored)
- `demo.mp4` — final output (gitignored, hosted on GitHub Releases)

# Demo Recording

The README demo GIF is recorded with [VHS](https://github.com/charmbracelet/vhs) and hosted as a GitHub Release asset (not checked into git).

## Re-record

```bash
brew install vhs        # one-time
vhs demo/demo.tape      # generates demo/demo.gif
```

## Upload to GitHub Release

```bash
gh release upload v<VERSION> demo/demo.gif --clobber
```

Then update the URL in `README.md` if the version changed:

```markdown
![skilltree demo](https://github.com/imarios/skilltree/releases/download/v<VERSION>/demo.gif)
```

## Files

- `demo.tape` — VHS script (checked in, edit to change the demo)
- `demo.gif` — generated output (gitignored, hosted on GitHub Releases)

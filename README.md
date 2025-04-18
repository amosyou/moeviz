# moeviz

visualize token routing in mixture-of-experts models

## setup

the visualization uses `vite` and `d3`, which requires `Node.js version 18+/20+`.

```bash
cd client/src
npm install
npm run dev

```

use `uv` to setup and activate Python environment. then,

```
uv pip install -r pyproject.toml
python3 moeviz/server.py
```

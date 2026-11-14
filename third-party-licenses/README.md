# Third-party licence texts

`gdal.node`, the native module inside `gdal-async`, includes these libraries,
but the `gdal-async` npm package does not carry their licence files. The copies
here ship with release builds. `scripts/prepare-release-assets.cjs` puts them
beside the other licence files under `gdal-async/licenses/`.

| Folder   | Source                                                                    |
| -------- | ------------------------------------------------------------------------- |
| `gdal`   | `LICENSE.TXT` from GDAL 3.12.3 (<https://github.com/OSGeo/gdal>)          |
| `libaec` | `LICENSE.txt` from libaec 1.1.3 (<https://gitlab.dkrz.de/k202009/libaec>) |

Refresh them when a `gdal-async` upgrade changes the GDAL or libaec version.

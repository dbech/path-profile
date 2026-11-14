# Third-party notices

Path Profile's own source code is MIT licensed. See `LICENSE`, shipped as
`LICENSE.path-profile.txt` in the install folder.

Release builds bundle the third-party software below. Each component stays under
its own licence. This file covers the main components. It is not a full
inventory of every transitive dependency.

## Electron and Chromium

Electron is MIT licensed. Chromium and its dependencies carry their own
licences. electron-builder ships both sets of licence text in the install folder
as `LICENSE.electron.txt` and `LICENSES.chromium.html`.

## Node.js

`resources/node/node.exe` is an unmodified Node.js runtime, used to run the
raster worker. Node.js is MIT licensed and bundles dependencies under their own
licences. The full text is at <https://github.com/nodejs/node/blob/main/LICENSE>.
When the build machine's Node.js install includes that file, a copy ships as
`resources/node/LICENSE`.

## gdal-async

`resources/node_modules/gdal-async` is the unmodified
[gdal-async](https://github.com/mmomtchev/node-gdal-async) npm package, trimmed
to its runtime files. It is Apache-2.0 licensed. The licence ships as
`resources/node_modules/gdal-async/LICENSE`, and the package version is in the
`package.json` beside it.

Its native module, `gdal.node`, is built with these libraries inside it:

| Library  | Licence            |
| -------- | ------------------ |
| GDAL     | MIT                |
| PROJ     | MIT                |
| GEOS     | LGPL-2.1           |
| HDF5     | BSD-3-Clause style |
| netCDF   | BSD-3-Clause       |
| curl     | curl (MIT style)   |
| Expat    | MIT                |
| OpenJPEG | BSD-2-Clause       |
| muparser | BSD-2-Clause       |
| libaec   | BSD-2-Clause       |
| SQLite   | Public domain      |

The licence files that the gdal-async package carries for these libraries ship
under `resources/node_modules/gdal-async/licenses/`. GDAL's licence, which also
covers the libraries GDAL vendors, is at <https://gdal.org/en/stable/license.html>.

### GEOS and the LGPL

GEOS is licensed under the GNU Lesser General Public License, version 2.1. Its
text ships as `resources/node_modules/gdal-async/licenses/libgeos/COPYING`.

The GEOS source, exactly as built into `gdal.node`, is in the gdal-async npm
package of the same version under `deps/libgeos`, with the build scripts. Path
Profile loads `gdal.node` from
`resources/node_modules/gdal-async/lib/binding/` when it runs. To use a modified
GEOS, rebuild gdal-async for the bundled Node.js version and replace that file.

## Other npm packages

`resources/node_modules` also holds the JavaScript packages gdal-async depends
on. Each keeps the licence file its package ships.

The app's own bundles include these packages and their dependencies:

| Package         | Licence      |
| --------------- | ------------ |
| React           | MIT          |
| Next.js         | MIT          |
| OpenLayers      | BSD-2-Clause |
| Chart.js        | MIT          |
| react-chartjs-2 | MIT          |
| lucide-react    | ISC          |
| pngjs           | MIT          |

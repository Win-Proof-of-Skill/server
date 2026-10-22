# Shardus Test Overview
## Requirement before running shardus test
- `shardus-network` tool must be installed with `multiple-archivers` option
  1. `git clone  https://gitlab.com/shardus/tools/shardus-network.git`
  2. `cd shardus-network``
  3. `git checkout multiple-archivers`
  4. `npm run install`
  5. `npm link`
- `shardus-global-server` repo must be installed locally
- Win `server` repo must be installed locally
## How to run the test
1. Choose an appropriate `START_NETWORK_SIZE`. (for instance 10)
2. Set `minNode` to `START_NETWORK_SIZE` in win/src/config/index.ts and compile it. `maxNode` should be set at least 2 times of `START_NETWORK_SIZE`
3. Set `START_NETWORK_SIZE` to 10 (as an example) in win/src/tests/shardus.test.ts
4. Open terminal in win directory and run `npm t tests/shardus.test.ts --watch`

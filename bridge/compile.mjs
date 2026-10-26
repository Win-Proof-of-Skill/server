import solc from 'solc'
import fs from 'node:fs'
import path from 'node:path'
const source = fs.readFileSync(new URL('./WINBridge.sol', import.meta.url), 'utf8')
export function compile(extra = {}) {
  const input = {
    language: 'Solidity',
    sources: { 'WINBridge.sol': { content: source }, ...extra },
    settings: {
      evmVersion: 'paris',
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
    },
  }
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (name) => {
        if (!name.startsWith('@openzeppelin/contracts/')) return { error: 'Unexpected import' }
        return { contents: fs.readFileSync(path.join(import.meta.dirname, 'node_modules', name), 'utf8') }
      },
    }),
  )
  if (output.errors?.some((e) => e.severity === 'error')) throw new Error(output.errors.map((e) => e.formattedMessage).join('\n'))
  return output.contracts
}
if (process.argv[1] === import.meta.filename) {
  fs.mkdirSync(new URL('./artifacts', import.meta.url), { recursive: true })
  fs.writeFileSync(new URL('./artifacts/WINBridge.json', import.meta.url), JSON.stringify(compile()['WINBridge.sol'].WINBridge, null, 2))
  console.log('WINBridge compiled. No transaction sent.')
}

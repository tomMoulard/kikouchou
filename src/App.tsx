import { useState } from 'react'
import reactLogo from '@/assets/react.svg'
import viteLogo from '/vite.svg'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center justify-center p-8">
      <div className="flex gap-8 mb-8">
        <a href="https://vite.dev" target="_blank" rel="noopener noreferrer" className="transition-transform hover:scale-110">
          <img src={viteLogo} className="h-24 w-24" alt="Vite logo" />
        </a>
        <a href="https://react.dev" target="_blank" rel="noopener noreferrer" className="transition-transform hover:scale-110">
          <img src={reactLogo} className="h-24 w-24 animate-spin" style={{ animationDuration: '20s' }} alt="React logo" />
        </a>
      </div>
      <h1 className="text-5xl font-bold text-white mb-8">Vite + React</h1>
      <div className="bg-slate-700 rounded-lg p-6 mb-4">
        <button 
          onClick={() => setCount((count) => count + 1)}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors"
        >
          count is {count}
        </button>
        <p className="text-slate-300 mt-4">
          Edit <code className="bg-slate-600 px-2 py-1 rounded">src/App.tsx</code> and save to test HMR
        </p>
      </div>
      <p className="text-slate-400">
        Click on the Vite and React logos to learn more
      </p>
    </div>
  )
}

export default App

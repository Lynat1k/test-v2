import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App.tsx'
import Chart2dPreview from './chart2d/Chart2dPreview.tsx'

const root = document.getElementById('root')!

if (window.location.hash === '#chart2d-preview') {
  createRoot(root).render(<Chart2dPreview />)
} else {
  createRoot(root).render(<App />)
}

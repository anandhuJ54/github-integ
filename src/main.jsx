import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import 'antd/dist/antd.css';

const rootElement = document.getElementById('root');
createRoot(rootElement).render(<App />);

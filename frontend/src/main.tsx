import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installSpringTokens } from './motion/spring';
import './styles.css';
import './glass.css';

installSpringTokens();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

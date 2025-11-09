import { createRoot } from 'react-dom/client';
import SysMLEditor from './sysml-editor';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<SysMLEditor />);
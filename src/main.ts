import './style.css';
import { App } from './ui/app';
import { SettingsPanel } from './ui/settings-panel';

new SettingsPanel();
new App(document.getElementById('app')!);

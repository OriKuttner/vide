import { Component, HostListener, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { TabsComponent } from './components/tabs/tabs.component';
import { EditorComponent } from './components/editor/editor.component';
import { StatusBarComponent } from './components/status-bar/status-bar.component';
import { SearchModalComponent } from './components/search-modal/search-modal.component';
import { WorkspaceService } from './services/workspace.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    SidebarComponent,
    TabsComponent,
    EditorComponent,
    StatusBarComponent,
    SearchModalComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  public workspaceService = inject(WorkspaceService);
  readonly title = signal('Vector-ide');
  readonly cursor = signal<{ line: number; column: number }>({ line: 1, column: 1 });

  onCursorChange(pos: { line: number; column: number }): void {
    this.cursor.set(pos);
  }

  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'p') {
      event.preventDefault();
      this.workspaceService.openModal('file-search');
    } else if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      (event.key === 'F' || event.key === 'f')
    ) {
      event.preventDefault();
      this.workspaceService.openModal('grep');
    } else if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      this.workspaceService.saveCurrentFile();
    } else if ((event.ctrlKey || event.metaKey) && (event.key === 'b' || event.key === 'B')) {
      event.preventDefault();
      this.workspaceService.toggleSidebar();
    }
  }
}

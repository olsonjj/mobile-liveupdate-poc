import { Component, OnInit } from '@angular/core';
import { UpdateService } from './live-update/update.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  constructor(private readonly updateService: UpdateService) {}

  ngOnInit(): void {
    // Non-blocking initialization — the app shows its current bundle
    // immediately and the update check runs in the background.
    this.updateService.initialize().catch((err) => {
      console.warn('[AppComponent] UpdateService initialization error:', err);
    });
  }
}
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AppComponent } from './app.component';
import { UpdateService } from './live-update/update.service';

describe('AppComponent', () => {
  beforeEach(async () => {
    const updateServiceMock = jasmine.createSpyObj<UpdateService>(
      'UpdateService',
      ['initialize'],
    );

    await TestBed.configureTestingModule({
      declarations: [AppComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
      providers: [{ provide: UpdateService, useValue: updateServiceMock }],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
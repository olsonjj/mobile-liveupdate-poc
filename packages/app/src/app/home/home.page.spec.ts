import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { of } from 'rxjs';

import { HomePage } from './home.page';
import { UpdateService } from '../live-update/update.service';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;

  beforeEach(async () => {
    // Create a minimal mock for UpdateService
    const updateServiceMock = jasmine.createSpyObj<UpdateService>(
      'UpdateService',
      ['initialize', 'performCheck', 'refreshState'],
    );
    Object.defineProperty(updateServiceMock, 'state$', { value: of(null) });
    Object.defineProperty(updateServiceMock, 'checkResult$', { value: of(null) });

    await TestBed.configureTestingModule({
      declarations: [HomePage],
      imports: [IonicModule.forRoot()],
      providers: [{ provide: UpdateService, useValue: updateServiceMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
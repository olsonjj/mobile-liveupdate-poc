import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { BehaviorSubject } from 'rxjs';

import { HomePage } from './home.page';
import { UpdateService } from '../live-update/update.service';
import type { CheckResult, GetStateResult } from '../live-update/types';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;
  let updateServiceMock: jasmine.SpyObj<UpdateService>;
  let stateSubject: BehaviorSubject<GetStateResult | null>;
  let checkResultSubject: BehaviorSubject<CheckResult | null>;
  let isUpdatingSubject: BehaviorSubject<boolean>;

  beforeEach(async () => {
    // Create reactive subjects so tests can push state changes
    stateSubject = new BehaviorSubject<GetStateResult | null>(null);
    checkResultSubject = new BehaviorSubject<CheckResult | null>(null);
    isUpdatingSubject = new BehaviorSubject<boolean>(false);

    updateServiceMock = jasmine.createSpyObj<UpdateService>(
      'UpdateService',
      ['initialize', 'performCheck', 'refreshState', 'rollback', 'beginUpdate', 'dismissOverlay'],
    );
    Object.defineProperty(updateServiceMock, 'state$', { value: stateSubject.asObservable() });
    Object.defineProperty(updateServiceMock, 'checkResult$', { value: checkResultSubject.asObservable() });
    Object.defineProperty(updateServiceMock, 'isUpdating$', { value: isUpdatingSubject.asObservable() });

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

  describe('Roll Back button', () => {
    it('should be disabled when state.previous is null', () => {
      stateSubject.next({ current: 2, previous: null });
      fixture.detectChanges();

      expect(component.hasPrevious).toBeFalse();

      const button = fixture.nativeElement.querySelector(
        'ion-button',
      ) as HTMLIonButtonElement;
      expect(button.disabled).toBeTrue();
    });

    it('should be enabled when state.previous is non-null', () => {
      stateSubject.next({ current: 2, previous: 1 });
      fixture.detectChanges();

      expect(component.hasPrevious).toBeTrue();

      const button = fixture.nativeElement.querySelector(
        'ion-button',
      ) as HTMLIonButtonElement;
      expect(button.disabled).toBeFalse();
    });

    it('should call updateService.rollback when clicked', () => {
      updateServiceMock.rollback.and.returnValue(
        Promise.resolve({ success: true, version: 1, error: null }),
      );

      stateSubject.next({ current: 2, previous: 1 });
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector(
        'ion-button',
      ) as HTMLIonButtonElement;
      button.click();

      expect(updateServiceMock.rollback).toHaveBeenCalledTimes(1);
    });

    it('should NOT call rollback via click when previous is null (guard)', () => {
      // Even though the button is disabled, verify the component guard works
      component.hasPrevious = false;
      component.rollBack();
      expect(updateServiceMock.rollback).not.toHaveBeenCalled();
    });

    it('should log a warning when rollback fails', fakeAsync(() => {
      spyOn(console, 'warn');
      updateServiceMock.rollback.and.returnValue(
        Promise.resolve({ success: false, version: null, error: 'No previous bundle to roll back to' }),
      );

      component.hasPrevious = true;
      component.rollBack();
      tick();

      expect(console.warn).toHaveBeenCalledWith(
        '[HomePage] Rollback failed:',
        'No previous bundle to roll back to',
      );
    }));
  });
});
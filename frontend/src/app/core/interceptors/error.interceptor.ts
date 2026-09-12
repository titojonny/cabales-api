import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { ToastController } from '@ionic/angular';
import { catchError, throwError } from 'rxjs';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toastCtrl = inject(ToastController);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      let mensaje = 'Ocurrió un error inesperado';

      if (error.error?.message) {
        mensaje = error.error.message;
      } else if (error.status === 0) {
        mensaje = 'No se pudo conectar con el servidor Cabales. Verifica que el backend esté corriendo.';
      } else if (error.status === 404) {
        mensaje = 'Recurso no encontrado';
      } else if (error.status === 409) {
        mensaje = error.error?.message || 'Conflicto: la cuenta está cerrada o ya existe';
      }

      toastCtrl
        .create({
          message: mensaje,
          duration: 3500,
          color: 'danger',
          position: 'top',
          buttons: [{ text: 'OK', role: 'cancel' }]
        })
        .then((toast) => toast.present());

      return throwError(() => error);
    })
  );
};

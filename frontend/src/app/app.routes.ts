import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'events',
    loadComponent: () => import('./pages/dashboard/dashboard.page').then((m) => m.DashboardPage),
  },
  {
    path: 'events/:id',
    loadComponent: () => import('./pages/event-detail/event-detail.page').then((m) => m.EventDetailPage),
  },
  {
    path: 'events/:id/settlement',
    loadComponent: () => import('./pages/settlement/settlement.page').then((m) => m.SettlementPage),
  },
  {
    path: '',
    redirectTo: 'events',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'events',
  }
];

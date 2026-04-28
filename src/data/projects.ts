export type ProjectStatus = 'in-progress' | 'shipped' | 'archived' | 'maintenance';

export const statusLabel: Record<ProjectStatus, string> = {
  'in-progress': 'in progress',
  'shipped': 'shipped',
  'archived': 'archived',
  'maintenance': 'maintenance',
};

export interface Project {
  name: string;
  description: string;
  url?: string;
  language?: string;
  year?: string;
  status?: ProjectStatus;
  featured?: boolean;
}

export const projects: Project[] = [
  {
    name: 'Hexis',
    description: 'A life tracker. Habits, goals, and the small daily metrics that compound over time.',
    status: 'in-progress',
    year: '2026',
    featured: true,
  },
];

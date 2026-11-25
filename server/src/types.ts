export const COLUMNS = ['Backlog', 'Todo', 'In Progress', 'Done'] as const;
export const PRIORITIES = ['low', 'medium', 'high'] as const;

export type TaskStatus = (typeof COLUMNS)[number];
export type TaskPriority = (typeof PRIORITIES)[number];

export type Task = {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  assignee: string;
  status: TaskStatus;
  position: number;
  updatedAt: string;
};

export type NewTaskInput = {
  title: string;
  description: string;
  priority: TaskPriority;
  assignee: string;
  status: TaskStatus;
  position?: number;
};

export type EditTaskInput = {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  assignee?: string;
  status?: TaskStatus;
  position?: number;
  expectedUpdatedAt?: string;
};

export type ReorderInput = {
  taskId: string;
  targetStatus: TaskStatus;
  targetPosition: number;
  expectedUpdatedAt?: string;
};

export type BoardEvent =
  | {
      eventId: string;
      type: 'task.created';
      task: Task;
      timestamp: string;
      clientId: string;
      mutationId?: string;
    }
  | {
      eventId: string;
      type: 'task.updated';
      task: Task;
      affectedTasks?: Task[];
      timestamp: string;
      clientId: string;
      mutationId?: string;
    }
  | {
      eventId: string;
      type: 'task.deleted';
      taskId: string;
      affectedTasks?: Task[];
      timestamp: string;
      clientId: string;
      mutationId?: string;
    };

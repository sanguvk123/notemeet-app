import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/tauri', () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MiniRecorder from './MiniRecorder';

describe('MiniRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders idle state by default', () => {
    render(<MiniRecorder />);
    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByTitle('Start Recording')).toBeInTheDocument();
  });

  it('shows recording state after clicking toggle', async () => {
    const { invoke } = await import('@tauri-apps/api/tauri');
    render(<MiniRecorder />);

    const button = screen.getByTitle('Start Recording');
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/Recording/)).toBeInTheDocument();
    });
    expect(invoke).toHaveBeenCalledWith('start_recording', { meetingType: 'meeting' });
  });

  it('shows stop icon when recording', async () => {
    render(<MiniRecorder />);
    fireEvent.click(screen.getByTitle('Start Recording'));

    await waitFor(() => {
      expect(screen.getByTitle('Stop & Generate')).toBeInTheDocument();
    });
  });

  it('calls stop_recording when toggled during recording', async () => {
    const { invoke } = await import('@tauri-apps/api/tauri');
    render(<MiniRecorder />);

    fireEvent.click(screen.getByTitle('Start Recording'));
    await waitFor(() => expect(screen.getByTitle('Stop & Generate')).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('Stop & Generate'));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('stop_recording', { title: 'Quick Note' });
    });
  });

  it('returns to idle after stopping', async () => {
    render(<MiniRecorder />);

    fireEvent.click(screen.getByTitle('Start Recording'));
    await waitFor(() => expect(screen.getByText(/Recording/)).toBeInTheDocument());

    fireEvent.click(screen.getByTitle('Stop & Generate'));
    await waitFor(() => {
      expect(screen.getByText('Idle')).toBeInTheDocument();
    });
  });

  it('has a draggable region', () => {
    const { container } = render(<MiniRecorder />);
    const dragRegion = container.querySelector('[data-tauri-drag-region]');
    expect(dragRegion).toBeTruthy();
  });
});

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProfilePhoto from './ProfilePhoto';

const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT;

describe('ProfilePhoto', () => {
  let container;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  afterAll(() => {
    if (previousActEnvironment === undefined) {
      delete global.IS_REACT_ACT_ENVIRONMENT;
    } else {
      global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    }
  });

  test('opens the full photo on click and closes on Escape', () => {
    act(() => {
      root.render(<ProfilePhoto src="/uploads/avatars/student.jpg" alt="Student" />);
    });

    act(() => {
      container.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[role="dialog"] img').getAttribute('src'))
      .toBe('/uploads/avatars/student.jpg');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test('closes the preview when its backdrop is clicked', () => {
    act(() => {
      root.render(<ProfilePhoto src="/avatar.jpg" alt="Student" />);
    });
    act(() => {
      container.querySelector('button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const backdrop = document.querySelector('.app-modal-overlay');
    act(() => {
      backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test('does not render a clickable avatar without a photo', () => {
    act(() => {
      root.render(<ProfilePhoto src={null} alt="Student" />);
    });

    expect(container.querySelector('button')).toBeNull();
  });
});

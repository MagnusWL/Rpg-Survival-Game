import { registerRootComponent } from 'expo';
import React from 'react';
import { ScrollView, Text } from 'react-native';

import App from './App';

// TEMPORARY debug boundary to surface the actual error text on screen while
// diagnosing the GameCanvas wiring. Remove once the crash is found.
class DebugErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null; info: string }> {
  state: { error: Error | null; info: string } = { error: null, info: '' };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info: info.componentStack ?? '' });
  }
  render() {
    if (this.state.error) {
      return React.createElement(
        ScrollView,
        { style: { flex: 1, backgroundColor: '#200', paddingTop: 40 } },
        React.createElement(Text, { style: { color: '#fff', padding: 12, fontSize: 12 } }, String(this.state.error.stack || this.state.error.message)),
        React.createElement(Text, { style: { color: '#faa', padding: 12, fontSize: 10 } }, this.state.info)
      );
    }
    return this.props.children;
  }
}

function Root() {
  return React.createElement(DebugErrorBoundary, null, React.createElement(App));
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Root);

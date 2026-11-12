#pragma once

/// Entry point installed as a Perl XSUB and called inside `/usr/bin/perl`, an
/// Apple-signed process that MediaRemote still serves on macOS 15.4+.
/// Streams now-playing state as JSON lines on stdout and reads commands
/// (`play`, `pause`, `toggle`, `next`, `previous`, `seek <seconds>`) from stdin.
/// Never returns: the process exits when stdin closes.
void notch_media_bridge_run(void *perl, void *cv);

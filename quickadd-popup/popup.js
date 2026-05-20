#!/usr/bin/env gjs

imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gdk = '4.0';

const { Gdk, Gio, GLib, Gtk } = imports.gi;
const System = imports.system;

function argValue(name, fallback = '') {
  const idx = ARGV.indexOf(name);
  return idx >= 0 && idx + 1 < ARGV.length ? ARGV[idx + 1] : fallback;
}

const placeholder = argValue('--placeholder', 'Add task...');
const themeCss = argValue('--theme-css', '');

function loadCss(display) {
  const provider = new Gtk.CssProvider();
  let css = '';

  if (themeCss && GLib.file_test(themeCss, GLib.FileTest.EXISTS)) {
    const [ok, contents] = GLib.file_get_contents(themeCss);
    if (ok) css += imports.byteArray.toString(contents);
  }

  css += `
window.spqa-window { background: transparent; }
.spqa-panel { min-width: 620px; }
.spqa-entry { caret-color: var(--spqa-accent); }
`;

  provider.load_from_data(css, -1);
  Gtk.StyleContext.add_provider_for_display(
    display,
    provider,
    Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
  );
}

const app = new Gtk.Application({
  application_id: 'dev.patrickfanella.SuperProductivityQuickAdd',
  flags: Gio.ApplicationFlags.NON_UNIQUE,
});

app.connect('activate', () => {
  const display = Gdk.Display.get_default();
  if (display) loadCss(display);

  const win = new Gtk.ApplicationWindow({
    application: app,
    title: 'Super Productivity Quick Add',
    default_width: 720,
    default_height: 120,
    resizable: false,
    decorated: false,
    modal: true,
  });
  win.add_css_class('spqa-window');

  const panel = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 10,
    margin_top: 18,
    margin_bottom: 18,
    margin_start: 18,
    margin_end: 18,
  });
  panel.add_css_class('spqa-panel');

  const entry = new Gtk.Entry({
    placeholder_text: placeholder,
    activates_default: true,
    hexpand: true,
  });
  entry.add_css_class('spqa-entry');

  const hint = new Gtk.Label({
    label: '#tag  +project  @today  30m    Enter to add · Esc to cancel',
    halign: Gtk.Align.START,
  });
  hint.add_css_class('spqa-hint');

  panel.append(entry);
  panel.append(hint);
  win.set_child(panel);

  const finish = (code) => {
    win.close();
    System.exit(code);
  };

  const submit = () => {
    const text = entry.get_text().trim();
    if (text.length > 0) print(text);
    finish(text.length > 0 ? 0 : 1);
  };

  entry.connect('activate', submit);

  const addEscapeController = (widget) => {
    const controller = new Gtk.EventControllerKey();
    controller.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
    controller.connect('key-pressed', (_ctrl, keyval) => {
      if (keyval === Gdk.KEY_Escape) {
        finish(1);
        return true;
      }
      return false;
    });
    widget.add_controller(controller);
  };

  addEscapeController(win);
  addEscapeController(entry);

  win.present();
  entry.grab_focus();
});

// We parse ARGV ourselves above. Passing it into Gtk.Application makes GTK
// treat flags like --theme-css as application options and abort before activate.
app.run([]);

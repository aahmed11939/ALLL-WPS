{pkgs}: {
  deps = [
    pkgs.chromium
    pkgs.atk
    pkgs.pango
    pkgs.gtk3
    pkgs.dbus
    pkgs.cups
    pkgs.at-spi2-atk
    pkgs.alsa-lib
    pkgs.expat
    pkgs.xorg.libxcb
    pkgs.xorg.libXrandr
    pkgs.xorg.libXfixes
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.xorg.libX11
    pkgs.mesa
    pkgs.libdrm
    pkgs.nspr
    pkgs.nss
  ];
}

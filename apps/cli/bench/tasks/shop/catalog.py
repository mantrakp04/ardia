CATEGORIES = [
    ("docks-hubs", "Docks & Hubs", "USB-C and Thunderbolt docks, hubs and adapters for one cable to your desk."),
    ("monitors", "Monitors", "4K, ultrawide and portable displays for work and play."),
    ("keyboards-mice", "Keyboards & Mice", "Mechanical, low-profile and ergonomic input gear."),
    ("webcams-audio", "Webcams & Audio", "Look and sound sharp on every call."),
    ("cables-adapters", "Cables & Adapters", "Certified cables and the adapters you always forget."),
    ("chargers-power", "Chargers & Power", "GaN chargers, power banks and surge protection."),
    ("desk", "Desk Setup", "Monitor arms, stands, lighting and cable management."),
]


def dock(sku, name, brand, price, was, rating, reviews, rank, added, card, host, outputs, dual, single, charging, adapter, ports, extra=None):
    specs = [("Host connection", host), ("Video outputs", outputs), ("Two displays", dual), ("One display", single),
             ("Laptop charging", charging), ("Power adapter", adapter), ("Data ports", ports)]
    specs += extra or [("Ethernet", "Gigabit (RJ-45)"), ("Compatibility", "Windows 10/11, macOS 12+, ChromeOS"), ("Warranty", "2 years")]
    return dict(sku=sku, name=name, brand=brand, cat="docks-hubs", price=price, was=was, rating=rating, reviews=reviews,
                rank=rank, added=added, card=card, specs=specs)


DOCKS = [
    dock("DK-1180", "Nimbus 7-in-1 USB-C Hub", "Nimbus", 3999, None, 4.3, 2210, 9, "2025-03-02", "4K HDMI · 100W pass-through · SD",
         "USB-C (USB 3.2 Gen 1)", "1 × HDMI 1.4", "Not supported", "4K @ 30 Hz", "Up to 85 W (100 W pass-through)", "Not included (uses your laptop charger)", "2 × USB-A 5 Gbps, 1 × USB-C data, SD/microSD"),
    dock("DK-2205", "Brightlane 8-in-1 USB-C Hub", "Brightlane", 4999, 5999, 4.4, 1384, 6, "2025-08-19", "4K60 HDMI · 85W charging · Ethernet",
         "USB-C (USB 3.2 Gen 2)", "1 × HDMI 2.0", "Not supported", "4K @ 60 Hz", "Up to 85 W", "Not included (uses your laptop charger)", "3 × USB-A 10 Gbps, 1 × USB-C data"),
    dock("DK-3317", "Corvex DualView 10-in-1 USB-C Dock, Dual 4K Display", "Corvex", 11999, 13999, 4.1, 642, 1, "2026-02-11", "Dual 4K · 100W PD · 10 ports",
         "USB-C (DP Alt Mode, MST)", "2 × HDMI 1.4", "2 × 4K @ 30 Hz", "4K @ 30 Hz", "Up to 100 W", "130 W, included", "3 × USB-A 5 Gbps, 1 × USB-C 10 Gbps, SD/microSD, 3.5 mm audio"),
    dock("DK-3542", "Tallis Duo Pro USB-C Dock, Dual 4K60, 100W PD", "Tallis", 12999, None, 4.2, 518, 2, "2026-04-03", "Dual 4K60 · 100W PD · 11 ports",
         "USB-C (DP Alt Mode, DSC)", "2 × HDMI 2.0, 1 × DisplayPort 1.4 (any two)", "2 × 4K @ 60 Hz", "4K @ 60 Hz", "Up to 85 W (100 W PD input)", "100 W, included", "4 × USB-A 10 Gbps, 1 × USB-C 10 Gbps, SD"),
    dock("DK-3608", "Orrin Triple Display USB-C Dock", "Orrin", 12499, None, 4.0, 297, 4, "2025-11-27", "3 displays · 100W PD · 13 ports",
         "USB-C (DisplayLink)", "1 × HDMI 2.0, 2 × HDMI 1.4", "4K @ 60 Hz + 1080p @ 60 Hz", "4K @ 60 Hz", "Up to 100 W", "135 W, included", "4 × USB-A 5 Gbps, 2 × USB-C 10 Gbps", [("Ethernet", "Gigabit (RJ-45)"), ("Compatibility", "Windows, macOS (DisplayLink driver required)"), ("Warranty", "1 year")]),
    dock("DK-2814", "Harbor H12 Dual 4K USB-C Docking Station", "Harbor", 14999, 18999, 4.6, 873, 14, "2026-05-21", "Dual 4K60 · 100W charging · 12 ports",
         "USB-C (DP Alt Mode, DSC)", "2 × HDMI 2.0, 2 × DisplayPort 1.4 (any two)", "2 × 4K @ 60 Hz", "5K @ 60 Hz", "Up to 100 W", "135 W, included", "4 × USB-A 10 Gbps, 2 × USB-C 10 Gbps, SD/microSD, 3.5 mm audio"),
    dock("DK-4016", "Kepler Station 13 Dual 4K60 USB-C Dock", "Kepler", 15999, None, 4.5, 1102, 3, "2026-01-09", "Dual 4K60 · 100W charging · 13 ports",
         "USB-C (DP Alt Mode, MST/DSC)", "2 × HDMI 2.0, 1 × DisplayPort 1.4", "2 × 4K @ 60 Hz", "4K @ 120 Hz", "Up to 100 W", "150 W, included", "4 × USB-A 10 Gbps, 2 × USB-C 10 Gbps, SD/microSD"),
    dock("DK-4102", "Vantro TB4 Thunderbolt 4 Dock", "Vantro", 22999, None, 4.7, 455, 7, "2025-10-14", "Thunderbolt 4 · dual 4K60 · 96W",
         "Thunderbolt 4 / USB4 (works with USB-C)", "2 × Thunderbolt 4 downstream, 1 × HDMI 2.0", "2 × 4K @ 60 Hz", "8K @ 30 Hz", "Up to 96 W", "180 W, included", "3 × USB-A 10 Gbps, 3 × Thunderbolt 4", [("Ethernet", "2.5 GbE (RJ-45)"), ("Compatibility", "Thunderbolt 3/4, USB4, USB-C"), ("Warranty", "2 years")]),
    dock("DK-4130", "Vantro TB4 Pro Thunderbolt Dock", "Vantro", 27999, 29999, 4.8, 211, 16, "2026-06-30", "Thunderbolt 4 · dual 4K60 · 100W",
         "Thunderbolt 4 / USB4 (works with USB-C)", "2 × Thunderbolt 4 downstream, 2 × HDMI 2.1", "2 × 4K @ 60 Hz", "8K @ 60 Hz", "Up to 100 W", "230 W, included", "4 × USB-A 10 Gbps, 3 × Thunderbolt 4", [("Ethernet", "2.5 GbE (RJ-45)"), ("Compatibility", "Thunderbolt 3/4, USB4, USB-C"), ("Warranty", "3 years")]),
    dock("DK-1525", "Lumio Travel Mini Dock", "Lumio", 6999, None, 4.2, 389, 11, "2025-06-05", "4K60 · 65W · folds flat",
         "USB-C (USB 3.2 Gen 2)", "1 × HDMI 2.0", "Not supported", "4K @ 60 Hz", "Up to 65 W", "Not included (uses your laptop charger)", "2 × USB-A 10 Gbps, 1 × USB-C data"),
    dock("DK-1033", "Sable 6-in-1 USB-C Hub", "Sable", 2999, 3499, 4.1, 3120, 12, "2024-11-12", "4K HDMI · 100W pass-through",
         "USB-C (USB 3.2 Gen 1)", "1 × HDMI 1.4", "Not supported", "4K @ 30 Hz", "Up to 85 W (100 W pass-through)", "Not included (uses your laptop charger)", "3 × USB-A 5 Gbps"),
    dock("DK-3920", "Arcwell DL-6950 DisplayLink Dock", "Arcwell", 17999, None, 4.3, 160, 15, "2025-09-08", "Dual 4K60 · 65W · DisplayLink",
         "USB-C or USB-A (DisplayLink)", "2 × HDMI 2.0, 2 × DisplayPort 1.2", "2 × 4K @ 60 Hz", "4K @ 60 Hz", "Up to 65 W", "120 W, included", "4 × USB-A 5 Gbps, 1 × USB-C 5 Gbps", [("Ethernet", "Gigabit (RJ-45)"), ("Compatibility", "Windows, macOS (DisplayLink driver required)"), ("Warranty", "3 years")]),
    dock("DK-1710", "Fennel USB-C Mini Dock", "Fennel", 5999, None, 4.0, 248, 18, "2025-12-01", "4K60 · 100W · compact",
         "USB-C (USB 3.2 Gen 2)", "1 × HDMI 2.0", "Not supported", "4K @ 60 Hz", "Up to 100 W", "Not included (uses your laptop charger)", "2 × USB-A 10 Gbps, 1 × USB-C data"),
    dock("DK-4255", "Ridgeway 15-in-1 Triple Display Dock", "Ridgeway", 18999, None, 4.4, 330, 19, "2026-03-17", "Dual 4K60 or triple 1440p · 100W",
         "USB-C (DP Alt Mode, MST/DSC)", "2 × HDMI 2.0, 1 × DisplayPort 1.4", "2 × 4K @ 60 Hz", "4K @ 60 Hz", "Up to 100 W", "150 W, included", "5 × USB-A 10 Gbps, 2 × USB-C 10 Gbps, SD/microSD"),
    dock("DK-1960", "Nimbus Pro 11-in-1 Dual HDMI Dock", "Nimbus", 8999, 9999, 4.0, 713, 8, "2025-07-22", "Dual HDMI · 4K · 100W PD",
         "USB-C (DP Alt Mode, MST)", "2 × HDMI 1.4", "2 × 4K @ 30 Hz (Windows only)", "4K @ 30 Hz", "Up to 100 W", "100 W, included", "3 × USB-A 5 Gbps, 1 × USB-C 5 Gbps, SD"),
    dock("DK-3388", "Brightlane Dual 4K60 USB-C Dock", "Brightlane", 13999, None, 4.3, 402, 13, "2026-08-02", "Dual 4K60 · 90W charging",
         "USB-C (DP Alt Mode, DSC)", "2 × HDMI 2.0", "2 × 4K @ 60 Hz", "4K @ 60 Hz", "Up to 90 W", "120 W, included", "3 × USB-A 10 Gbps, 1 × USB-C 10 Gbps"),
    dock("DK-4044", "Tallis Duo Max USB-C Dock", "Tallis", 16499, None, 4.5, 288, 5, "2026-07-15", "Dual 4K60 · 100W charging · 12 ports",
         "USB-C (DP Alt Mode, DSC)", "2 × HDMI 2.0, 2 × DisplayPort 1.4 (any two)", "2 × 4K @ 60 Hz", "5K @ 60 Hz", "Up to 100 W", "140 W, included", "4 × USB-A 10 Gbps, 2 × USB-C 10 Gbps, SD"),
    dock("DK-2450", "Kepler Station 9 USB-C Dock, Dual 4K", "Kepler", 10999, 12999, 4.2, 965, 10, "2025-05-30", "Dual 4K · 100W charging · 9 ports",
         "USB-C (DP Alt Mode, MST)", "2 × HDMI (HDMI 1: 2.0, HDMI 2: 1.4)", "4K @ 60 Hz + 4K @ 30 Hz", "4K @ 60 Hz", "Up to 100 W", "120 W, included", "3 × USB-A 10 Gbps, 1 × USB-C 10 Gbps"),
    dock("DK-4380", "Orrin Vertical Dual 4K Dock", "Orrin", 19999, None, 4.4, 121, 20, "2026-09-10", "Dual 4K60 · 100W · stands upright",
         "USB-C (DP Alt Mode, DSC)", "2 × DisplayPort 1.4", "2 × 4K @ 60 Hz", "6K @ 60 Hz", "Up to 100 W", "150 W, included", "4 × USB-A 10 Gbps, 2 × USB-C 10 Gbps"),
    dock("DK-0890", "Lumio 4-Port USB-C Data Hub", "Lumio", 2499, None, 4.5, 1740, 17, "2024-09-03", "4 × USB-C · 10 Gbps",
         "USB-C (USB 3.2 Gen 2)", "None", "Not supported", "Not supported", "Not supported", "Not included", "4 × USB-C 10 Gbps"),
    dock("DK-2962", "Sable Dual 4K60 USB-C Hub, 100W Pass-Through", "Sable", 9999, None, 4.1, 577, 0, "2026-06-12", "Dual 4K60 · 100W PD",
         "USB-C (DP Alt Mode, DSC)", "2 × HDMI 2.0", "2 × 4K @ 60 Hz", "4K @ 60 Hz", "Up to 85 W (100 W pass-through)", "Not included (uses your laptop charger)", "2 × USB-A 10 Gbps, 1 × USB-C data"),
    dock("DK-4290", "Anvil USB-C Dock Gen 2", "Anvil", 15499, 17999, 4.5, 690, 21, "2026-04-28", "Dual 4K60 · 100W charging · 11 ports",
         "USB-C (DP Alt Mode, DSC)", "2 × HDMI 2.0, 1 × DisplayPort 1.4", "2 × 4K @ 60 Hz", "4K @ 120 Hz", "Up to 100 W", "135 W, included", "3 × USB-A 10 Gbps, 2 × USB-C 10 Gbps, SD"),
]


def simple(cat, prefix, rows, keys):
    out = []
    for i, (name, brand, price, was, rating, reviews, card, *values) in enumerate(rows):
        out.append(dict(sku=f"{prefix}-{3100 + i * 37}", name=name, brand=brand, cat=cat, price=price, was=was, rating=rating,
                        reviews=reviews, rank=(i * 7) % len(rows), added=f"2026-{1 + (i * 5) % 10:02d}-{3 + (i * 11) % 25:02d}",
                        card=card, specs=list(zip(keys, values)) + [("Warranty", "1 year" if i % 3 else "2 years")]))
    return out


MONITORS = simple("monitors", "MN", [
    ("Corvex 27\" 4K IPS Monitor U27", "Corvex", 32999, 37999, 4.5, 812, "27\" 4K · 60 Hz · USB-C 65W", "27 in", "3840 × 2160", "60 Hz", "IPS", "USB-C 65 W, HDMI 2.0, DP 1.4"),
    ("Kepler View 32 4K USB-C Monitor", "Kepler", 44999, None, 4.6, 403, "32\" 4K · 60 Hz · USB-C 90W", "31.5 in", "3840 × 2160", "60 Hz", "IPS", "USB-C 90 W, HDMI 2.0 ×2, DP 1.4"),
    ("Brightlane 24\" 1080p Office Monitor", "Brightlane", 12999, 14999, 4.2, 2210, "24\" FHD · 75 Hz", "23.8 in", "1920 × 1080", "75 Hz", "IPS", "HDMI 1.4, VGA"),
    ("Harbor 34\" Curved Ultrawide", "Harbor", 49999, 54999, 4.4, 377, "34\" WQHD · 100 Hz · curved", "34 in", "3440 × 1440", "100 Hz", "VA", "HDMI 2.0 ×2, DP 1.4"),
    ("Tallis 27\" QHD 165 Hz", "Tallis", 27999, None, 4.3, 655, "27\" QHD · 165 Hz", "27 in", "2560 × 1440", "165 Hz", "IPS", "HDMI 2.0 ×2, DP 1.4"),
    ("Orrin 15.6\" Portable Monitor", "Orrin", 17999, 19999, 4.1, 980, "15.6\" FHD · USB-C powered", "15.6 in", "1920 × 1080", "60 Hz", "IPS", "USB-C ×2, mini HDMI"),
    ("Vantro 27\" 5K Studio Display", "Vantro", 129999, None, 4.7, 142, "27\" 5K · Thunderbolt 4", "27 in", "5120 × 2880", "60 Hz", "IPS", "Thunderbolt 4 96 W, USB-C ×3"),
    ("Ridgeway 28\" 4K Monitor", "Ridgeway", 29999, None, 4.2, 288, "28\" 4K · 60 Hz", "28 in", "3840 × 2160", "60 Hz", "IPS", "HDMI 2.0 ×2, DP 1.4"),
    ("Corvex 24\" 4K USB-C Monitor", "Corvex", 27999, 29999, 4.4, 510, "24\" 4K · USB-C 65W", "23.8 in", "3840 × 2160", "60 Hz", "IPS", "USB-C 65 W, HDMI 2.0"),
    ("Kepler View 27 QHD USB-C", "Kepler", 31999, None, 4.5, 699, "27\" QHD · USB-C 90W · KVM", "27 in", "2560 × 1440", "75 Hz", "IPS", "USB-C 90 W, HDMI 2.0, DP 1.4"),
    ("Brightlane 32\" 4K Office Monitor", "Brightlane", 34999, 39999, 4.1, 205, "32\" 4K · 60 Hz", "31.5 in", "3840 × 2160", "60 Hz", "VA", "HDMI 2.0 ×2, DP 1.2"),
    ("Sable 27\" FHD Monitor", "Sable", 14999, None, 4.0, 1630, "27\" FHD · 75 Hz", "27 in", "1920 × 1080", "75 Hz", "VA", "HDMI 1.4, DP 1.2"),
], ["Screen size", "Resolution", "Refresh rate", "Panel", "Inputs"])

INPUT = simple("keyboards-mice", "KB", [
    ("Kestrel Low-Profile Wireless Keyboard", "Kestrel", 7999, None, 4.4, 1210, "Low-profile · Bluetooth · 3 devices", "Bluetooth 5.1, USB receiver", "Full size", "12 months (AAA)"),
    ("Tallis K2 Mechanical Keyboard", "Tallis", 11999, 13999, 4.6, 840, "Hot-swap · Brown switches · 75%", "USB-C, Bluetooth", "75%", "200 hours"),
    ("Corvex Ergo Split Keyboard", "Corvex", 14999, None, 4.3, 312, "Split · tenting · wireless", "Bluetooth 5.0", "Split full size", "3 months"),
    ("Harbor M5 Ergonomic Mouse", "Harbor", 6999, 7999, 4.5, 2210, "Vertical · 6 buttons · quiet", "Bluetooth, USB receiver", "Vertical, right hand", "70 days"),
    ("Brightlane Silent Mouse", "Brightlane", 2499, None, 4.2, 3120, "Silent clicks · 18-month battery", "USB receiver", "Ambidextrous", "18 months (AA)"),
    ("Kepler Precision Trackball", "Kepler", 8999, None, 4.4, 488, "Thumb trackball · 4 buttons", "Bluetooth, USB receiver", "Right hand", "4 months"),
    ("Nimbus Compact Keyboard & Mouse Set", "Nimbus", 4999, 5999, 4.1, 960, "Wireless combo · spill resistant", "USB receiver", "Compact", "24 months"),
    ("Vantro MX Pro Mouse", "Vantro", 9999, None, 4.7, 1520, "8K DPI · MagSpeed wheel", "Bluetooth, USB receiver", "Right hand", "70 days"),
    ("Sable Numeric Keypad", "Sable", 1999, None, 4.0, 605, "Wireless numpad", "USB receiver", "Numpad", "12 months"),
], ["Connection", "Layout / shape", "Battery life"])

AUDIO = simple("webcams-audio", "AV", [
    ("Kepler 4K Webcam with Light", "Kepler", 12999, 14999, 4.4, 702, "4K30 · auto-framing · ring light", "4K @ 30 fps", "Dual mics", "USB-C"),
    ("Brightlane 1080p Webcam", "Brightlane", 3999, None, 4.1, 2880, "1080p · privacy shutter", "1080p @ 30 fps", "Mono mic", "USB-A"),
    ("Harbor Talk Pro Speakerphone", "Harbor", 14999, None, 4.5, 390, "360° pickup · 6 mics", "—", "6 mics", "USB-C, Bluetooth"),
    ("Tallis ANC Office Headset", "Tallis", 17999, 19999, 4.6, 655, "ANC · boom mic · 40 h", "—", "Boom mic", "Bluetooth, USB dongle"),
    ("Corvex USB Desk Mic", "Corvex", 8999, None, 4.3, 830, "Cardioid · mute tap · USB-C", "—", "Condenser", "USB-C"),
    ("Orrin 2K Webcam", "Orrin", 6999, None, 4.2, 411, "1440p · HDR · wide angle", "1440p @ 30 fps", "Dual mics", "USB-C"),
    ("Vantro Studio Webcam", "Vantro", 19999, None, 4.7, 233, "4K60 · large sensor", "4K @ 60 fps", "Dual mics", "USB-C"),
], ["Video", "Microphone", "Connection"])

CABLES = simple("cables-adapters", "CB", [
    ("Kestrel USB-C to USB-C 240W Cable, 2 m", "Kestrel", 1999, None, 4.6, 4120, "240W · USB 2.0 data · 2 m", "2 m", "240 W", "480 Mbps"),
    ("Kestrel Thunderbolt 4 Cable, 1 m", "Kestrel", 4999, 5999, 4.7, 960, "40 Gbps · 100W · 8K", "1 m", "100 W", "40 Gbps"),
    ("Harbor USB-C to HDMI 2.1 Adapter", "Harbor", 2499, None, 4.4, 1310, "8K60 / 4K120", "15 cm", "—", "—"),
    ("Brightlane USB-C to DisplayPort Cable, 2 m", "Brightlane", 2299, None, 4.3, 870, "8K30 / 4K144", "2 m", "—", "—"),
    ("Sable HDMI 2.1 Cable, 2 m (2-pack)", "Sable", 1799, 2199, 4.5, 2650, "48 Gbps · 4K120", "2 m", "—", "48 Gbps"),
    ("Nimbus USB-C to Ethernet Adapter", "Nimbus", 1999, None, 4.2, 1530, "Gigabit · aluminum", "12 cm", "—", "1 Gbps"),
    ("Corvex USB-C Extension Cable, 1 m", "Corvex", 1599, None, 4.0, 540, "10 Gbps · 100W · 4K60", "1 m", "100 W", "10 Gbps"),
    ("Kestrel DisplayPort 1.4 Cable, 2 m", "Kestrel", 1499, None, 4.6, 1980, "8K60 / 4K144", "2 m", "—", "32.4 Gbps"),
], ["Length", "Power rating", "Data speed"])

POWER = simple("chargers-power", "PW", [
    ("Kestrel 140W GaN Charger, 3 ports", "Kestrel", 8999, 10999, 4.6, 1720, "140W · 2 × USB-C + USB-A", "140 W", "2 × USB-C, 1 × USB-A"),
    ("Brightlane 65W Compact Charger", "Brightlane", 3499, None, 4.4, 3010, "65W · foldable plug", "65 W", "1 × USB-C"),
    ("Harbor 100W 4-Port Desktop Charger", "Harbor", 6999, None, 4.5, 860, "100W · 4 ports", "100 W", "3 × USB-C, 1 × USB-A"),
    ("Tallis 20,000 mAh Power Bank", "Tallis", 5999, 6999, 4.3, 1440, "65W laptop charging", "65 W", "2 × USB-C, 1 × USB-A"),
    ("Nimbus 12-Outlet Surge Protector", "Nimbus", 3999, None, 4.6, 2560, "4,200 J · 2 USB-C", "30 W (USB)", "12 AC, 2 × USB-C"),
    ("Corvex Desk Power Strip with USB-C", "Corvex", 4499, None, 4.2, 410, "Clamp-on · 65W USB-C", "65 W (USB)", "4 AC, 2 × USB-C"),
], ["Max output", "Ports"])

DESK = simple("desk", "DS", [
    ("Kestrel Dual Monitor Arm", "Kestrel", 11999, 13999, 4.5, 1630, "Gas spring · up to 32\" each", "2 monitors, 4–9 kg each", "Clamp or grommet"),
    ("Harbor Laptop Stand, Aluminum", "Harbor", 4999, None, 4.6, 2440, "6 heights · foldable", "Laptops 11–17\"", "Freestanding"),
    ("Brightlane Monitor Light Bar", "Brightlane", 5999, None, 4.4, 910, "Asymmetric · auto-dim", "Monitors 0.4–3 cm thick", "Clips on monitor"),
    ("Orrin Under-Desk Cable Tray", "Orrin", 2999, 3499, 4.3, 720, "Steel · 80 cm", "Up to 10 kg", "Screw-mount"),
    ("Tallis Wool Desk Mat", "Tallis", 4499, None, 4.5, 530, "90 × 40 cm · felt", "—", "—"),
    ("Corvex Single Monitor Arm", "Corvex", 6999, None, 4.2, 860, "Up to 34\" · 9 kg", "1 monitor, 2–9 kg", "Clamp or grommet"),
], ["Capacity", "Mounting"])

PRODUCTS = DOCKS + MONITORS + INPUT + AUDIO + CABLES + POWER + DESK

COUPONS = {
    "DESKDAYS": {"percent": 15, "cats": {"docks-hubs", "cables-adapters"}, "ends": "2026-11-15", "min": 0},
    "FALL10": {"percent": 10, "cats": None, "ends": "2026-11-30", "min": 15000},
    "SCREENS25": {"percent": 25, "cats": {"monitors"}, "ends": "2026-11-22", "min": 0},
    "TECH20": {"percent": 20, "cats": None, "ends": "2026-11-01", "min": 0},
}

SHIPPING = [
    ("standard", "Standard", 0, 995, "Arrives Fri, Nov 13 – Wed, Nov 18"),
    ("expedited", "Expedited", 1295, 1295, "Arrives by Wed, Nov 11"),
    ("twoday", "2-Day", 1995, 1995, "Arrives by Tue, Nov 10"),
    ("overnight", "Overnight", 3495, 3495, "Arrives Mon, Nov 9"),
]

STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
          "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
          "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"]

POSTS = [
    ("dual-monitor-dock-guide", "How to pick a dock for two 4K monitors", "2026-10-28",
     ["Two 4K screens on one cable is the most common setup we get asked about, and the box art doesn't always tell the whole story.",
      "Look at the spec table, not the headline. “Dual 4K” on a box can mean both screens at 30 Hz, which feels laggy for everyday work. You want 4K @ 60 Hz listed for two displays.",
      "Check what the dock actually sends to your laptop. A dock can accept a 100 W charger but keep some of it for its own ports. The line to read is Laptop charging."]),
    ("october-tech-sale", "Our October Tech Sale is on", "2026-10-15",
     ["From now through Sunday, Nov 1, take 20% off almost everything with code TECH20 at checkout.",
      "Stock up on cables, chargers and desk gear before the holidays. Some exclusions apply; see Deals for details."]),
    ("cable-management-101", "Cable management in 20 minutes", "2026-09-30",
     ["An under-desk tray, a handful of velcro ties and a clamp-on power strip go a long way.",
      "Route the dock's power brick into the tray so only one cable reaches the laptop."]),
]

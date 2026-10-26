import type { ReactNode } from "react";
import { View } from "react-native";
import { NOTES, TABS, type Article } from "./content";
import { fill, hairline, type Geo } from "./geometry";
import { Favicon, Glyph, Label } from "./Kit";
import { pick, type Look } from "./look";

export function Hero({ g, look, a, height }: { g: Geo; look: Look; a: Article; height: number }) {
  const h = a.hero;
  return (
    <View style={{ height: height * g.s, borderRadius: 12 * g.s, overflow: "hidden", backgroundColor: pick(look, h.sky) }}>
      <View style={{ position: "absolute", right: "18%", top: height * 0.16 * g.s, width: height * 0.26 * g.s, height: height * 0.26 * g.s, borderRadius: height * 0.13 * g.s, backgroundColor: pick(look, h.sun) }} />
      <View style={{ position: "absolute", left: "-20%", width: "90%", top: height * 0.42 * g.s, height: height * 1.4 * g.s, borderRadius: height * 0.9 * g.s, backgroundColor: pick(look, h.far) }} />
      <View style={{ position: "absolute", left: "35%", width: "95%", top: height * 0.52 * g.s, height: height * 1.4 * g.s, borderRadius: height * 0.9 * g.s, backgroundColor: pick(look, h.near) }} />
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.2 * g.s, backgroundColor: pick(look, h.sea) }} />
    </View>
  );
}

export function Page({ g, look, a = NOTES, top = 0, children }: { g: Geo; look: Look; a?: Article; top?: number; children?: ReactNode }) {
  return (
    <View style={[fill, { top: top * g.s, backgroundColor: look.page }]} pointerEvents="none">
      <View style={{ height: 58 * g.s, backgroundColor: pick(look, a.band), flexDirection: "row", alignItems: "center", paddingHorizontal: 36 * g.s, justifyContent: "space-between" }}>
        <Label g={g} size={19} color={look.ink} weight="700" family="Georgia">
          {a.site}
        </Label>
        <View style={{ flexDirection: "row", gap: 18 * g.s }}>
          {["Journal", "Maps", "About"].map((n) => (
            <Label key={n} g={g} size={11.5} color={look.inkDim}>
              {n}
            </Label>
          ))}
        </View>
      </View>
      <View style={{ alignSelf: "center", width: "84%", maxWidth: 600 * g.s, paddingTop: 22 * g.s, gap: 12 * g.s }}>
        <Hero g={g} look={look} a={a} height={168} />
        <View style={{ gap: 4 * g.s }}>
          <Label g={g} size={23} color={look.ink} weight="700" family="Georgia" lines={2}>
            {a.title}
          </Label>
          <Label g={g} size={11.5} color={look.inkFaint}>
            {a.byline}
          </Label>
        </View>
        <Label g={g} size={12.5} color={look.inkDim} lines={4} style={{ lineHeight: 19 * g.s }}>
          {a.body}
        </Label>
        {children}
      </View>
    </View>
  );
}

export function NewTabPage({ g, look, top = 0, width }: { g: Geo; look: Look; top?: number; width: number }) {
  const barW = Math.min(520, width - 60);
  return (
    <View style={[fill, { top: top * g.s, alignItems: "center", backgroundColor: look.card }]} pointerEvents="none">
      <View style={{ marginTop: 120 * g.s, width: barW * g.s, height: 43 * g.s, borderRadius: 14 * g.s, backgroundColor: look.t.ntpBarSolid, borderWidth: hairline, borderColor: look.t.ntpBarBorder, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 * g.s, gap: 9 * g.s }}>
        <Glyph g={g} name="magnifyingglass" size={14} color={look.t.textSecondary} weight="medium" box={18} />
        <Label g={g} size={15} color={look.t.placeholder}>
          Search or enter address
        </Label>
      </View>
      <View style={{ flexDirection: "row", gap: 16 * g.s, marginTop: 30 * g.s }}>
        {TABS.slice(0, 6).map((t) => (
          <View key={t.title} style={{ alignItems: "center", gap: 6 * g.s }}>
            <View style={{ width: 46 * g.s, height: 46 * g.s, borderRadius: 12 * g.s, backgroundColor: look.t.pinnedResting, alignItems: "center", justifyContent: "center" }}>
              <Favicon g={g} t={t} size={22} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

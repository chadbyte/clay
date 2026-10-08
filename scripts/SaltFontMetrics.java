// Development-only exporter for the pinned Salt reference font profile.
// Compile/run with the reference PlantUML 1.2026.8 JAR; never needed by Clay users.
import java.io.*;
import java.util.zip.GZIPOutputStream;
import net.sourceforge.plantuml.FileFormat;
import net.sourceforge.plantuml.StringBounderSvg;
import net.sourceforge.plantuml.klimt.font.*;

public class SaltFontMetrics {
  public static void main(String[] args) throws Exception {
    var faces = new UFontFace[] { UFontFace.normal(), UFontFace.bold(), UFontFace.italic(), UFontFace.boldItalic() };
    var output = new DataOutputStream(new GZIPOutputStream(new FileOutputStream(args[0])));
    var bounder = new StringBounderSvg(net.sourceforge.plantuml.text.SvgCharSizeHack.NO_HACK);
    for (var face : faces) {
      var font = UFontFactory.build(args.length > 2 ? args[2] : "SansSerif", UFontFace.normal(), args.length > 1 ? Integer.parseInt(args[1]) : 12).withFontFace(face);
      for (var cp = 0; cp < 65536; cp++) {
        var text = String.valueOf((char)cp);
        var dim = FileFormat.getJavaDimension(font, text);
        output.writeFloat((float)dim.getWidth());
        output.writeFloat((float)dim.getHeight());
        output.writeFloat((float)bounder.getDescent(font, text));
      }
    }
    output.close();
  }
}
